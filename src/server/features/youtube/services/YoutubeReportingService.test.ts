import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as ReportingModule from "./YoutubeReportingService";
import type * as ServiceModule from "./YoutubeService";

const api = vi.hoisted(() => ({
  query: vi.fn(),
  listVideos: vi.fn(),
  listChannels: vi.fn(),
  getUserInfoEmail: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/google/googleAccess", () => ({
  getGoogleAccessMode: async () => "own_client",
}));
vi.mock("@/server/lib/youtubeClient", () => ({
  createYoutubeClient: () => api,
}));

// The services bind `db` when they load, and this file's database is created
// in beforeAll, so the import has to wait until that client exists.
let client: Client;
const directory = mkdtempSync(join(tmpdir(), "youtube-reports-"));
let reporting: typeof ReportingModule.YoutubeReportingService;
let youtube: typeof ServiceModule.YoutubeService;

const CHANNEL_ID = "UC0123456789012345678901";
const BRAND_ID = "UCbrandaccount0000000000";
const VIDEO_ID = "abcdefghijk";
const SCOPES =
  "https://www.googleapis.com/auth/yt-analytics.readonly,https://www.googleapis.com/auth/youtube.readonly";

beforeAll(async () => {
  client = createClient({ url: `file:${join(directory, "test.db")}` });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));
  await client.executeMultiple(`
    CREATE TABLE account (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      provider_id text NOT NULL,
      account_id text NOT NULL,
      scope text
    );
    CREATE TABLE youtube_connections (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      organization_id text NOT NULL,
      channel_id text NOT NULL,
      channel_title text NOT NULL,
      channel_custom_url text,
      channel_thumbnail_url text,
      connected_by_user_id text NOT NULL,
      youtube_account_id text NOT NULL,
      connected_account_email text,
      created_at text NOT NULL DEFAULT '2026-01-01',
      updated_at text NOT NULL DEFAULT '2026-01-01'
    );
    CREATE UNIQUE INDEX youtube_connections_project_idx ON youtube_connections (project_id);
  `);
  ({ YoutubeReportingService: reporting } =
    await import("./YoutubeReportingService"));
  ({ YoutubeService: youtube } = await import("./YoutubeService"));
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true });
});

beforeEach(async () => {
  api.query.mockReset();
  api.listVideos.mockReset();
  api.listChannels.mockReset();
  api.getUserInfoEmail.mockReset();
  api.getUserInfoEmail.mockResolvedValue("owner@example.com");
  await client.executeMultiple(
    "DELETE FROM youtube_connections; DELETE FROM account;",
  );
});

async function seed(scope: string | null = SCOPES) {
  await client.execute({
    sql: "INSERT INTO account (id, user_id, provider_id, account_id, scope) VALUES ('a1', 'user-1', 'youtube', 'google-1', ?)",
    args: [scope],
  });
  await client.execute({
    sql: `INSERT INTO youtube_connections (
      id, project_id, organization_id, channel_id, channel_title,
      connected_by_user_id, youtube_account_id
    ) VALUES ('c1', 'project-1', 'org-1', ?, 'Example', 'user-1', 'google-1')`,
    args: [CHANNEL_ID],
  });
}

function metricRow(views: number, video?: string) {
  return {
    ...(video ? { video } : {}),
    views,
    estimatedMinutesWatched: views * 2,
    averageViewDuration: 45,
    subscribersGained: 4,
    subscribersLost: 1,
    likes: 3,
    comments: 2,
    shares: 1,
  };
}

describe("YouTube reports", () => {
  it("refuses a project with no channel before calling YouTube", async () => {
    await expect(
      reporting.getChannelOverview({ projectId: "project-1" }),
    ).rejects.toMatchObject({ code: "youtube_not_connected" });
    expect(api.query).not.toHaveBeenCalled();
  });

  it("refuses a grant that is missing a YouTube scope before calling YouTube", async () => {
    await seed("https://www.googleapis.com/auth/yt-analytics.readonly");
    await expect(
      reporting.getChannelOverview({ projectId: "project-1" }),
    ).rejects.toMatchObject({ code: "youtube_scope_missing" });
    expect(api.query).not.toHaveBeenCalled();
  });

  it("compares the channel overview with the previous period of the same length", async () => {
    await seed();
    api.query
      .mockResolvedValueOnce([metricRow(200)])
      .mockResolvedValueOnce([metricRow(80)]);

    const overview = await reporting.getChannelOverview({
      projectId: "project-1",
      startDate: "2026-03-01",
      endDate: "2026-03-07",
    });

    expect(api.query).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channelId: CHANNEL_ID,
        metrics: [
          "views",
          "estimatedMinutesWatched",
          "averageViewDuration",
          "subscribersGained",
          "subscribersLost",
          "likes",
          "comments",
          "shares",
        ],
        startDate: "2026-03-01",
        endDate: "2026-03-07",
      }),
    );
    expect(api.query).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        startDate: "2026-02-22",
        endDate: "2026-02-28",
      }),
    );
    expect(overview.comparison.views).toMatchObject({
      current: 200,
      previous: 80,
      absoluteChange: 120,
      percentChange: 150,
    });
    expect(overview.current.shares).toBe(1);
  });

  it("attaches video titles and keeps a row whose title is gone", async () => {
    await seed();
    api.query.mockResolvedValue([
      metricRow(10, VIDEO_ID),
      metricRow(4, "zzzzzzzzzzz"),
    ]);
    api.listVideos.mockResolvedValue([
      { videoId: VIDEO_ID, title: "Launch", channelId: CHANNEL_ID },
    ]);

    const result = await reporting.getTopVideos({ projectId: "project-1" });

    expect(api.query).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: ["video"],
        sort: "-views",
        maxResults: 10,
        startIndex: 1,
      }),
    );
    expect(result.rows.map((row) => [row.videoId, row.title])).toEqual([
      [VIDEO_ID, "Launch"],
      ["zzzzzzzzzzz", null],
    ]);
  });

  it("asks YouTube for traffic source types and search terms separately", async () => {
    await seed();
    api.query.mockResolvedValue([
      {
        insightTrafficSourceType: "YT_SEARCH",
        views: 9,
        estimatedMinutesWatched: 3,
      },
    ]);
    await reporting.getTrafficSources({ projectId: "project-1", limit: 5 });
    expect(api.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dimensions: ["insightTrafficSourceType"],
        sort: "-views",
        maxResults: 5,
      }),
    );

    api.query.mockResolvedValue([
      {
        insightTrafficSourceDetail: "open seo",
        views: 4,
        estimatedMinutesWatched: 2,
      },
    ]);
    const terms = await reporting.getSearchTerms({ projectId: "project-1" });
    expect(api.query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dimensions: ["insightTrafficSourceDetail"],
        filters: "insightTrafficSourceType==YT_SEARCH",
        maxResults: 25,
      }),
    );
    expect(terms.rows).toEqual([
      { term: "open seo", views: 4, estimatedMinutesWatched: 2 },
    ]);
  });

  it("reads one video on the connected channel and rejects a video from another channel", async () => {
    await seed();
    api.listVideos.mockResolvedValueOnce([
      {
        videoId: VIDEO_ID,
        title: "Elsewhere",
        channelId: "UCsomeoneelse00000000000",
      },
    ]);
    await expect(
      reporting.getVideoStats({ projectId: "project-1", videoId: VIDEO_ID }),
    ).rejects.toMatchObject({ code: "youtube_video_not_in_channel" });
    expect(api.query).not.toHaveBeenCalled();

    api.listVideos.mockResolvedValueOnce([
      { videoId: VIDEO_ID, title: "Launch", channelId: CHANNEL_ID },
    ]);
    api.query.mockResolvedValue([metricRow(12)]);
    const stats = await reporting.getVideoStats({
      projectId: "project-1",
      videoId: VIDEO_ID,
    });
    expect(api.query).toHaveBeenCalledWith(
      expect.objectContaining({ filters: `video==${VIDEO_ID}` }),
    );
    expect(stats.video).toEqual({ videoId: VIDEO_ID, title: "Launch" });
    expect(stats.metrics.views).toBe(12);
  });

  it("saves a Brand Account channel returned by mine=true and rejects one that was not", async () => {
    await client.execute({
      sql: "INSERT INTO account (id, user_id, provider_id, account_id, scope) VALUES ('a1', 'user-1', 'youtube', 'google-1', ?)",
      args: [SCOPES],
    });
    api.listChannels.mockResolvedValue([
      {
        channelId: CHANNEL_ID,
        title: "Personal",
        customUrl: "@personal",
        thumbnailUrl: "https://example.com/p.jpg",
      },
      {
        channelId: BRAND_ID,
        title: "Brand",
        customUrl: null,
        thumbnailUrl: null,
      },
    ]);

    const saved = await youtube.setChannel({
      projectId: "project-1",
      organizationId: "org-1",
      channelId: BRAND_ID,
      accountId: "google-1",
      userId: "user-1",
    });
    expect(saved).toMatchObject({
      channelId: BRAND_ID,
      channelTitle: "Brand",
      channelCustomUrl: null,
    });

    await expect(
      youtube.setChannel({
        projectId: "project-1",
        organizationId: "org-1",
        channelId: "UCnotreturned000000000000",
        accountId: "google-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = await client.execute(
      "SELECT channel_id FROM youtube_connections",
    );
    expect(row.rows).toEqual([{ channel_id: BRAND_ID }]);
  });
});
