import { beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import { makeToolContext, textContent } from "./tool-test-support";
import { getYoutubeChannelOverviewTool } from "./youtube-tools";

const mocks = vi.hoisted(() => ({
  getChannelOverview: vi.fn(),
  getProjectForOrganization: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/youtube/services/YoutubeReportingService", () => ({
  YoutubeReportingService: {
    getChannelOverview: mocks.getChannelOverview,
    getSearchTerms: vi.fn(),
    getTopVideos: vi.fn(),
    getTrafficSources: vi.fn(),
    getVideoStats: vi.fn(),
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

  it.each(["youtube_not_connected", "youtube_scope_missing"] as const)(
    "returns %s with a link to the channel connection",
    async (code) => {
      const message =
        code === "youtube_not_connected"
          ? "YouTube is not connected for this project. Connect a channel in project settings."
          : "The YouTube connection is missing YouTube Analytics read-only access. Reconnect and approve it.";
      mocks.getChannelOverview.mockRejectedValue(
        new YoutubeReportError(code, message),
      );

      const result = await getYoutubeChannelOverviewTool.handler(
        { projectId: "project_1" },
        toolContext,
      );

      expect(result.structuredContent).toMatchObject({
        status: "error",
        error: {
          code,
          message,
          actionUrl:
            "https://open-seo.test/p/project_1/settings/integrations#youtube",
        },
      });
      expect(textContent(result)).toContain(message);
      expect(textContent(result)).toContain("#youtube");
    },
  );
});
