import { shiftGa4Date } from "@/server/features/ga4/services/Ga4Dates";
import {
  GscNotConnectedError,
  GscService,
} from "@/server/features/gsc/services/GscService";
import {
  buildYoutubeOpportunities,
  type EmbeddingPage,
  type ExternalVideo,
  type OpportunityQuery,
} from "@/server/features/youtube/youtubeOpportunities";
import {
  assertDataScope,
  callReport,
  ready,
  titledRows,
  YoutubeReportingService,
  type ReportInput,
} from "@/server/features/youtube/services/YoutubeReportingService";
import {
  compareSubscriberNet,
  metricValue,
  resolveYoutubePreset,
  resolveYoutubeRange,
  rowLimit,
  YOUTUBE_OVERVIEW_METRICS,
  YOUTUBE_TRAFFIC_METRICS,
  YOUTUBE_VIDEO_ID,
} from "@/server/features/youtube/services/youtubeReportModel";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";

function resolveReportRange(input: ReportInput) {
  if (input.startDate || input.endDate) return resolveYoutubeRange(input);
  return resolveYoutubePreset(input.dateRange ?? "last_28_days");
}

function isQueryRejected(error: unknown): boolean {
  return (
    error instanceof YoutubeReportError &&
    error.code === "youtube_query_rejected"
  );
}

function fillDaily(
  startDate: string,
  endDate: string,
  rows: Array<{
    day: string;
    views: number | null;
    estimatedMinutesWatched: number | null;
  }>,
) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const series = [];
  for (let day = startDate; day <= endDate; day = shiftGa4Date(day, 1)) {
    const row = byDay.get(day);
    series.push({
      day,
      views: row?.views ?? 0,
      estimatedMinutesWatched: row?.estimatedMinutesWatched ?? 0,
    });
  }
  return series;
}

async function getDailySeries(input: ReportInput) {
  const context = await ready(input.projectId);
  const range = resolveReportRange(input);
  const rows = await callReport(context.client, {
    channelId: context.channelId,
    startDate: range.startDate,
    endDate: range.endDate,
    metrics: YOUTUBE_TRAFFIC_METRICS,
    dimensions: ["day"],
    sort: "day",
    maxResults: 200,
  });
  return fillDaily(
    range.startDate,
    range.endDate,
    rows.map((row) => ({
      day: typeof row.day === "string" ? row.day : "",
      views: metricValue(row, "views"),
      estimatedMinutesWatched: metricValue(row, "estimatedMinutesWatched"),
    })),
  );
}

async function getTopVideosCompared(input: ReportInput) {
  const context = await ready(input.projectId);
  assertDataScope(context);
  const range = resolveReportRange(input);
  const limit = rowLimit(input.limit);
  const rows = await callReport(context.client, {
    channelId: context.channelId,
    startDate: range.startDate,
    endDate: range.endDate,
    metrics: YOUTUBE_OVERVIEW_METRICS,
    dimensions: ["video"],
    sort: "-views",
    maxResults: limit,
  });
  const videos = await titledRows(context, rows);
  const ids = videos
    .map((video) => video.videoId)
    .filter((id) => YOUTUBE_VIDEO_ID.test(id));
  const previousViews = new Map<string, number | null>();
  if (ids.length > 0) {
    try {
      const previousRows = await callReport(context.client, {
        channelId: context.channelId,
        startDate: range.previousStartDate,
        endDate: range.previousEndDate,
        metrics: ["views"],
        dimensions: ["video"],
        filters: [`video==${ids.join(",")}`],
        sort: "-views",
        maxResults: ids.length,
      });
      for (const row of previousRows) {
        if (typeof row.video === "string") {
          previousViews.set(row.video, metricValue(row, "views"));
        }
      }
    } catch (error) {
      if (!isQueryRejected(error)) throw error;
    }
  }
  return videos.map((video) => ({
    ...video,
    previousViews: previousViews.get(video.videoId) ?? null,
  }));
}

async function getExternalTraffic(
  input: ReportInput & { videoIds: string[] },
): Promise<{
  videos: Array<{ videoId: string; externalViews: number }> | null;
  embeddingPages: EmbeddingPage[] | null;
}> {
  const ids = input.videoIds
    .filter((id) => YOUTUBE_VIDEO_ID.test(id))
    .slice(0, 25);
  if (ids.length === 0) return { videos: [], embeddingPages: null };
  const context = await ready(input.projectId);
  const range = resolveReportRange(input);
  const base = {
    channelId: context.channelId,
    startDate: range.startDate,
    endDate: range.endDate,
    metrics: ["views"] as const,
  };
  let videos: Array<{ videoId: string; externalViews: number }> | null;
  try {
    const rows = await callReport(context.client, {
      ...base,
      dimensions: ["video", "insightTrafficSourceType"],
      filters: [`video==${ids.join(",")}`, "insightTrafficSourceType==EXT_URL"],
      sort: "-views",
      maxResults: ids.length,
    });
    videos = rows.flatMap((row) => {
      if (typeof row.video !== "string" || !row.video) return [];
      return [
        { videoId: row.video, externalViews: metricValue(row, "views") ?? 0 },
      ];
    });
  } catch (error) {
    if (!isQueryRejected(error)) throw error;
    return { videos: null, embeddingPages: null };
  }
  try {
    const rows = await callReport(context.client, {
      ...base,
      dimensions: ["insightPlaybackLocationDetail"],
      filters: ["insightPlaybackLocationType==EMBEDDED"],
      sort: "-views",
      maxResults: 25,
    });
    const embeddingPages = rows.flatMap((row) => {
      const url = row.insightPlaybackLocationDetail;
      const views = metricValue(row, "views");
      if (typeof url !== "string" || !url.trim() || views === null) return [];
      return [{ url, views }];
    });
    return { videos, embeddingPages };
  } catch (error) {
    if (!isQueryRejected(error)) throw error;
    return { videos, embeddingPages: null };
  }
}

async function loadSearchConsole(
  projectId: string,
  range: { startDate: string; endDate: string },
): Promise<{
  status: "connected" | "not_connected" | "unavailable";
  queries: OpportunityQuery[] | null;
}> {
  try {
    const result = await GscService.getPerformance({
      projectId,
      startDate: range.startDate,
      endDate: range.endDate,
      dimensions: ["query"],
      rowLimit: 250,
    });
    return {
      status: "connected",
      queries: result.rows.flatMap((row) => {
        const query = row.keys?.[0];
        if (!query) return [];
        return [{ query, impressions: row.impressions, clicks: row.clicks }];
      }),
    };
  } catch (error) {
    return {
      status:
        error instanceof GscNotConnectedError ? "not_connected" : "unavailable",
      queries: null,
    };
  }
}

async function getReport(input: ReportInput) {
  const range = resolveReportRange(input);
  const dated = {
    projectId: input.projectId,
    startDate: range.startDate,
    endDate: range.endDate,
  };
  const [overview, daily, traffic, videos, terms, searchConsole] =
    await Promise.all([
      YoutubeReportingService.getChannelOverview(dated),
      getDailySeries(dated),
      YoutubeReportingService.getTrafficSources({ ...dated, limit: 25 }),
      getTopVideosCompared({ ...dated, limit: 25 }),
      YoutubeReportingService.getSearchTerms({ ...dated, limit: 25 }),
      loadSearchConsole(input.projectId, range),
    ]);
  const external = await getExternalTraffic({
    ...dated,
    videoIds: videos.map((video) => video.videoId),
  });
  const externalById = new Map(
    (external.videos ?? []).map((video) => [
      video.videoId,
      video.externalViews,
    ]),
  );
  const externalVideos: ExternalVideo[] | null =
    external.videos === null
      ? null
      : videos.map((video) => ({
          videoId: video.videoId,
          title: video.title,
          externalViews: externalById.get(video.videoId) ?? 0,
          totalViews: video.views ?? 0,
        }));
  return {
    connected: true as const,
    source: overview.source,
    request: range,
    current: overview.current,
    previous: overview.previous,
    comparison: {
      ...overview.comparison,
      subscribersNet: compareSubscriberNet(overview.current, overview.previous),
    },
    daily,
    trafficSources: traffic.rows,
    videos,
    searchTerms: terms.rows,
    searchConsole: searchConsole.status,
    embeddingPages:
      external.embeddingPages === null
        ? ("unavailable" as const)
        : ("available" as const),
    opportunities: buildYoutubeOpportunities({
      videos,
      searchTerms: terms.rows,
      searchConsoleQueries: searchConsole.queries,
      externalVideos,
      embeddingPages: external.embeddingPages,
    }),
  };
}

export const YoutubeReportService = { getReport };
