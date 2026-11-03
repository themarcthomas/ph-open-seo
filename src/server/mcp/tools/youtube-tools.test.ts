import { beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import { makeToolContext, textContent } from "./tool-test-support";
import {
  getYoutubeChannelOverviewTool,
  getYoutubeVideoStatsTool,
} from "./youtube-tools";

const mocks = vi.hoisted(() => ({
  getChannelOverview: vi.fn(),
  getTopVideos: vi.fn(),
  getTrafficSources: vi.fn(),
  getSearchTerms: vi.fn(),
  getVideoStats: vi.fn(),
  getProjectForOrganization: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/youtube/services/YoutubeReportingService", () => ({
  YoutubeReportingService: {
    getChannelOverview: mocks.getChannelOverview,
    getTopVideos: mocks.getTopVideos,
    getTrafficSources: mocks.getTrafficSources,
    getSearchTerms: mocks.getSearchTerms,
    getVideoStats: mocks.getVideoStats,
  },
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

const toolContext = makeToolContext();

describe("YouTube MCP tools", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  });

  it("returns a channel overview the text and structured result both describe", async () => {
    mocks.getChannelOverview.mockResolvedValue({
      status: "ok",
      source: {
        provider: "youtube",
        channelId: "UC0123456789012345678901",
        channelTitle: "Example",
      },
      request: {
        requestedDateRange: null,
        resolvedDateRange: { startDate: "2026-03-01", endDate: "2026-03-07" },
        previousDateRange: { startDate: "2026-02-22", endDate: "2026-02-28" },
        warnings: [],
        timeZone: "America/Los_Angeles",
      },
      current: { views: 200 },
      previous: { views: 80 },
      comparison: {
        views: {
          current: 200,
          previous: 80,
          absoluteChange: 120,
          percentChange: 150,
        },
        estimatedMinutesWatched: {
          current: null,
          previous: null,
          absoluteChange: null,
          percentChange: null,
        },
        averageViewDuration: {
          current: null,
          previous: null,
          absoluteChange: null,
          percentChange: null,
        },
        subscribersGained: {
          current: null,
          previous: null,
          absoluteChange: null,
          percentChange: null,
        },
        subscribersLost: {
          current: null,
          previous: null,
          absoluteChange: null,
          percentChange: null,
        },
        likes: {
          current: null,
          previous: null,
          absoluteChange: null,
          percentChange: null,
        },
        comments: {
          current: null,
          previous: null,
          absoluteChange: null,
          percentChange: null,
        },
        shares: {
          current: null,
          previous: null,
          absoluteChange: null,
          percentChange: null,
        },
      },
      warnings: [],
    });

    const result = await getYoutubeChannelOverviewTool.handler(
      { projectId: "project_1" },
      toolContext,
    );

    expect(textContent(result)).toContain("Example");
    expect(textContent(result)).toContain("Views: 200 vs 80 (+150%)");
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      source: { channelTitle: "Example" },
    });
    expect(
      getYoutubeChannelOverviewTool.config.outputSchema.safeParse(
        result.structuredContent,
      ).success,
    ).toBe(true);
  });

  it.each([
    ["youtube_not_connected", "YouTube is not connected for this project."],
    [
      "youtube_scope_missing",
      "The YouTube connection is missing the YouTube Analytics or YouTube read-only permission. Reconnect and approve both.",
    ],
  ] as const)(
    "reports %s with the integrations page",
    async (code, message) => {
      mocks.getVideoStats.mockRejectedValue(
        new YoutubeReportError(code, message),
      );

      const result = await getYoutubeVideoStatsTool.handler(
        { projectId: "project_1", videoId: "abcdefghijk" },
        toolContext,
      );

      expect(result.structuredContent).toMatchObject({
        status: "error",
        error: {
          code,
          message,
          actionUrl: "https://open-seo.test/p/project_1/settings/integrations",
        },
      });
      expect(textContent(result)).toContain(message);
    },
  );
});
