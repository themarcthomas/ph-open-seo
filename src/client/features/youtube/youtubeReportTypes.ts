import type { getYoutubeReport } from "@/serverFunctions/youtubeReport";

export type YoutubeReport = Extract<
  Awaited<ReturnType<typeof getYoutubeReport>>,
  { connected: true }
>;
