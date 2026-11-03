import { beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import { YoutubeReportService } from "./youtubeChannelReport";
import { YoutubeReportingService } from "./YoutubeReportingService";

const mocks = vi.hoisted(() => ({
  getByProjectId: vi.fn(),
  getGrant: vi.fn(),
  queryReport: vi.fn(),
  listVideoTitles: vi.fn(),
  createYoutubeClient: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/youtubeClient", () => ({
  createYoutubeClient: mocks.createYoutubeClient,
}));
vi.mock(
  "@/server/features/youtube/repositories/YoutubeConnectionRepository",
  () => ({
    YoutubeConnectionRepository: {
      getByProjectId: mocks.getByProjectId,
      getGrant: mocks.getGrant,
    },
  }),
);
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: vi.fn(async () => ({ rows: [] })) },
  GscNotConnectedError: class GscNotConnectedError extends Error {},
}));

const connection = {
  projectId: "p1",
  channelId: "UCbrandaccountchannel0001",
  channelTitle: "Brand channel",
  connectedByUserId: "u1",
  youtubeAccountId: "sub-a",
};

function metricRow(views: number) {
  return [
    {
      views,
      estimatedMinutesWatched: views * 2,
      averageViewDuration: 30,
      subscribersGained: 1,
      subscribersLost: 0,
      likes: 4,
      comments: 2,
      shares: 1,
    },
  ];
}

describe("YoutubeReportingService", () => {
  beforeEach(() => {
    mocks.getByProjectId.mockResolvedValue(connection);
    mocks.getGrant.mockResolvedValue({ accountId: "sub-a", scope: null });
    mocks.queryReport.mockResolvedValue([]);
    mocks.listVideoTitles.mockResolvedValue(new Map());
    mocks.createYoutubeClient.mockReturnValue({
      queryReport: mocks.queryReport,
      listVideoTitles: mocks.listVideoTitles,
    });
  });

  it("compares a date range with the immediately previous window", async () => {
    mocks.queryReport
      .mockResolvedValueOnce(metricRow(10))
      .mockResolvedValueOnce(metricRow(4));

    const result = await YoutubeReportingService.getChannelOverview({
      projectId: "p1",
      startDate: "2024-03-01",
      endDate: "2024-03-01",
    });

    expect(mocks.queryReport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channelId: connection.channelId,
        startDate: "2024-03-01",
        endDate: "2024-03-01",
      }),
    );
    expect(mocks.queryReport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        startDate: "2024-02-29",
        endDate: "2024-02-29",
      }),
    );
    expect(result.current?.views).toBe(10);
    expect(result.previous?.views).toBe(4);
    expect(result.comparison.views).toEqual({
      current: 10,
      previous: 4,
      absoluteChange: 6,
      percentChange: 1.5,
    });
    expect(result.comparison.subscribersLost.percentChange).toBe(0);
  });

  it("leaves percent change unknown when the previous value is zero", async () => {
    mocks.queryReport
      .mockResolvedValueOnce(metricRow(5))
      .mockResolvedValueOnce([
        { ...metricRow(0)[0], views: 0, subscribersLost: 0 },
      ]);
    const result = await YoutubeReportingService.getChannelOverview({
      projectId: "p1",
      startDate: "2026-01-02",
      endDate: "2026-01-08",
    });
    expect(result.request.previousStartDate).toBe("2025-12-26");
    expect(result.request.previousEndDate).toBe("2026-01-01");
    expect(result.comparison.views.percentChange).toBeNull();
  });

  it("reports not connected and a missing analytics scope before calling YouTube", async () => {
    mocks.getByProjectId.mockResolvedValue(null);
    await expect(
      YoutubeReportingService.getChannelOverview({ projectId: "p1" }),
    ).rejects.toMatchObject({ code: "youtube_not_connected" });

    mocks.getByProjectId.mockResolvedValue(connection);
    mocks.getGrant.mockResolvedValue({
      accountId: "sub-a",
      scope: "openid,email",
    });
    await expect(
      YoutubeReportingService.getTrafficSources({ projectId: "p1" }),
    ).rejects.toBeInstanceOf(YoutubeReportError);
    await expect(
      YoutubeReportingService.getTrafficSources({ projectId: "p1" }),
    ).rejects.toMatchObject({ code: "youtube_scope_missing" });
    expect(mocks.queryReport).not.toHaveBeenCalled();
  });

  it("asks YouTube for search terms with the YT_SEARCH detail filter", async () => {
    mocks.queryReport.mockResolvedValue([
      {
        insightTrafficSourceDetail: "open seo",
        views: 8,
        estimatedMinutesWatched: 12,
      },
    ]);

    const result = await YoutubeReportingService.getSearchTerms({
      projectId: "p1",
      startDate: "2026-04-01",
      endDate: "2026-04-07",
      limit: 10,
    });

    expect(mocks.queryReport).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: ["insightTrafficSourceDetail"],
        filters: ["insightTrafficSourceType==YT_SEARCH"],
        sort: "-views",
        maxResults: 10,
      }),
    );
    expect(result.rows).toEqual([
      { term: "open seo", views: 8, estimatedMinutesWatched: 12 },
    ]);
  });

  it("attaches video titles and keeps a missing title null", async () => {
    mocks.queryReport.mockResolvedValue([
      { video: "abcdefghijk", views: 3, estimatedMinutesWatched: 1 },
      { video: "zzzzzzzzzzz", views: 1, estimatedMinutesWatched: 1 },
    ]);
    mocks.listVideoTitles.mockResolvedValue(
      new Map([["abcdefghijk", "Launch"]]),
    );

    const result = await YoutubeReportingService.getTopVideos({
      projectId: "p1",
      startDate: "2026-04-01",
      endDate: "2026-04-02",
    });

    expect(mocks.listVideoTitles).toHaveBeenCalledWith([
      "abcdefghijk",
      "zzzzzzzzzzz",
    ]);
    expect(
      result.rows.map((row) => [row.videoId, row.title, row.views]),
    ).toEqual([
      ["abcdefghijk", "Launch", 3],
      ["zzzzzzzzzzz", null, 1],
    ]);
  });

  it("asks for a daily series and the previous period of the top videos", async () => {
    mocks.queryReport.mockImplementation(
      async (query: {
        dimensions?: readonly string[];
        filters?: readonly string[];
      }) => {
        const dimensions = query.dimensions ?? [];
        if (dimensions.includes("day")) {
          return [
            {
              day: "2026-04-02",
              views: 5,
              estimatedMinutesWatched: 8,
            },
          ];
        }
        if (dimensions.includes("insightTrafficSourceType")) return [];
        if (dimensions[0] === "video" && query.filters?.length) {
          return [{ video: "abcdefghijk", views: 4 }];
        }
        if (dimensions[0] === "video") {
          return [
            {
              video: "abcdefghijk",
              views: 10,
              estimatedMinutesWatched: 20,
              averageViewDuration: 90,
              subscribersGained: 1,
              subscribersLost: 0,
              likes: 0,
              comments: 0,
              shares: 0,
            },
          ];
        }
        return [];
      },
    );
    mocks.listVideoTitles.mockResolvedValue(
      new Map([["abcdefghijk", "Launch"]]),
    );

    const result = await YoutubeReportService.getReport({
      projectId: "p1",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
    });

    expect(mocks.queryReport).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: ["day"],
        metrics: ["views", "estimatedMinutesWatched"],
        sort: "day",
        startDate: "2026-04-01",
        endDate: "2026-04-03",
      }),
    );
    expect(mocks.queryReport).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: ["video"],
        filters: ["video==abcdefghijk"],
        startDate: "2026-03-29",
        endDate: "2026-03-31",
      }),
    );
    expect(result.daily).toEqual([
      { day: "2026-04-01", views: 0, estimatedMinutesWatched: 0 },
      { day: "2026-04-02", views: 5, estimatedMinutesWatched: 8 },
      { day: "2026-04-03", views: 0, estimatedMinutesWatched: 0 },
    ]);
    expect(result.videos[0]).toMatchObject({
      videoId: "abcdefghijk",
      title: "Launch",
      views: 10,
      previousViews: 4,
    });
  });

  it("refuses video titles when the Data API scope was not granted", async () => {
    mocks.getGrant.mockResolvedValue({
      accountId: "sub-a",
      scope: `openid,https://www.googleapis.com/auth/yt-analytics.readonly`,
    });
    await expect(
      YoutubeReportingService.getVideoStats({
        projectId: "p1",
        videoId: "abcdefghijk",
        startDate: "2026-04-01",
        endDate: "2026-04-02",
      }),
    ).rejects.toMatchObject({ code: "youtube_scope_missing" });
    expect(mocks.queryReport).not.toHaveBeenCalled();
  });
});
