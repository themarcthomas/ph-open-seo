import { z } from "zod";
import { YOUTUBE_REPORT_RANGES } from "@/shared/youtube";

export const youtubeReportInputSchema = z.object({
  projectId: z.string().min(1),
  dateRange: z.enum(YOUTUBE_REPORT_RANGES).default("last_28_days"),
});

/** /p/$projectId/youtube query params. */
export const youtubeReportSearchSchema = z.object({
  range: z.enum(YOUTUBE_REPORT_RANGES).optional().catch(undefined),
});

export type YoutubeReportSearch = z.infer<typeof youtubeReportSearchSchema>;
