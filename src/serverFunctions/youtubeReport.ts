import { createServerFn } from "@tanstack/react-start";
import { YoutubeReportService } from "@/server/features/youtube/services/youtubeChannelReport";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { youtubeReportInputSchema } from "@/types/schemas/youtube-report";

export const getYoutubeReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(youtubeReportInputSchema)
  .handler(async ({ data, context }) => {
    try {
      return await YoutubeReportService.getReport({
        projectId: context.projectId,
        dateRange: data.dateRange,
      });
    } catch (error) {
      if (
        error instanceof YoutubeReportError &&
        error.code === "youtube_not_connected"
      ) {
        return { connected: false as const };
      }
      throw error;
    }
  });
