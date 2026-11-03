import { getGoogleAccessMode } from "@/server/features/google/googleAccess";
import { grantOmitsScope } from "@/server/features/youtube/youtubeGrantScope";
import { YoutubeConnectionRepository } from "@/server/features/youtube/repositories/YoutubeConnectionRepository";
import {
  compareMetrics,
  metricValue,
  metricsFrom,
  resolveYoutubeRange,
  rowLimit,
  YOUTUBE_OVERVIEW_METRICS,
  YOUTUBE_TRAFFIC_METRICS,
  YOUTUBE_VIDEO_ID,
} from "@/server/features/youtube/services/youtubeReportModel";
import {
  createYoutubeClient,
  type YoutubeClient,
  type YoutubeReportQuery,
  type YoutubeReportRow,
} from "@/server/lib/youtubeClient";
import {
  YoutubeApiError,
  YoutubeMalformedResponseError,
  YoutubeReportError,
  YoutubeTokenError,
  youtubeReportErrorFromApi,
} from "@/server/lib/youtubeErrors";
import {
  YOUTUBE_ANALYTICS_SCOPE,
  YOUTUBE_DATA_SCOPE,
  YOUTUBE_REPORTING_TIME_ZONE,
  type YoutubeReportRange,
} from "@/shared/youtube";

export type ReportInput = {
  projectId: string;
  startDate?: string;
  endDate?: string;
  dateRange?: YoutubeReportRange;
  limit?: number;
};

type Ready = {
  channelId: string;
  channelTitle: string;
  client: YoutubeClient;
  enforceDataScope: boolean;
  scope: string | null;
};

export async function callReport(
  client: YoutubeClient,
  query: YoutubeReportQuery,
): Promise<YoutubeReportRow[]> {
  try {
    return await client.queryReport(query);
  } catch (error) {
    if (error instanceof YoutubeReportError) throw error;
    if (error instanceof YoutubeTokenError) {
      throw new YoutubeReportError(
        "youtube_reconnect_required",
        "The YouTube connection has expired or was revoked. Reconnect YouTube in project settings.",
      );
    }
    if (error instanceof YoutubeMalformedResponseError) {
      throw new YoutubeReportError("youtube_malformed_response", error.message);
    }
    if (error instanceof YoutubeApiError)
      throw youtubeReportErrorFromApi(error);
    throw error;
  }
}

export async function ready(projectId: string): Promise<Ready> {
  const connection =
    await YoutubeConnectionRepository.getByProjectId(projectId);
  if (!connection) {
    throw new YoutubeReportError(
      "youtube_not_connected",
      "YouTube is not connected for this project. Connect a channel in project settings.",
    );
  }
  const gateway = (await getGoogleAccessMode()) === "gateway";
  let scope: string | null = null;
  if (!gateway) {
    const grant = await YoutubeConnectionRepository.getGrant(
      connection.connectedByUserId,
      connection.youtubeAccountId,
    );
    if (!grant) {
      throw new YoutubeReportError(
        "youtube_reconnect_required",
        "The YouTube connection has expired or was revoked. Reconnect YouTube in project settings.",
      );
    }
    if (grantOmitsScope(grant.scope, YOUTUBE_ANALYTICS_SCOPE)) {
      throw new YoutubeReportError(
        "youtube_scope_missing",
        "The YouTube connection is missing YouTube Analytics read-only access. Reconnect and approve it.",
      );
    }
    scope = grant.scope;
  }
  return {
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
    client: createYoutubeClient({
      userId: connection.connectedByUserId,
      youtubeAccountId: connection.youtubeAccountId,
    }),
    enforceDataScope: !gateway,
    scope,
  };
}

export function assertDataScope(context: Ready) {
  if (
    context.enforceDataScope &&
    grantOmitsScope(context.scope, YOUTUBE_DATA_SCOPE)
  ) {
    throw new YoutubeReportError(
      "youtube_scope_missing",
      "The YouTube connection is missing YouTube read-only access, so channel and video details are unavailable. Reconnect and approve it.",
    );
  }
}

function source(context: Ready) {
  return {
    provider: "youtube" as const,
    channelId: context.channelId,
    channelTitle: context.channelTitle,
    timeZone: YOUTUBE_REPORTING_TIME_ZONE,
  };
}

async function oneRow(
  context: Ready,
  query: YoutubeReportQuery,
): Promise<YoutubeReportRow | undefined> {
  const rows = await callReport(context.client, query);
  return rows[0];
}

async function getChannelOverview(input: ReportInput) {
  const context = await ready(input.projectId);
  const range = resolveYoutubeRange(input);
  const base = {
    channelId: context.channelId,
    metrics: YOUTUBE_OVERVIEW_METRICS,
  };
  const [currentRow, previousRow] = await Promise.all([
    oneRow(context, {
      ...base,
      startDate: range.startDate,
      endDate: range.endDate,
    }),
    oneRow(context, {
      ...base,
      startDate: range.previousStartDate,
      endDate: range.previousEndDate,
    }),
  ]);
  const current = metricsFrom(currentRow);
  const previous = metricsFrom(previousRow);
  return {
    source: source(context),
    request: range,
    current,
    previous,
    comparison: compareMetrics(current, previous),
    warnings: [] as string[],
  };
}

export async function titledRows(context: Ready, rows: YoutubeReportRow[]) {
  assertDataScope(context);
  const videoIds = rows
    .map((row) => row.video)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  let titles = new Map<string, string>();
  try {
    titles = await context.client.listVideoTitles(videoIds);
  } catch (error) {
    if (error instanceof YoutubeApiError)
      throw youtubeReportErrorFromApi(error);
    if (error instanceof YoutubeTokenError) {
      throw new YoutubeReportError(
        "youtube_reconnect_required",
        "The YouTube connection has expired or was revoked. Reconnect YouTube in project settings.",
      );
    }
    if (error instanceof YoutubeMalformedResponseError) {
      throw new YoutubeReportError("youtube_malformed_response", error.message);
    }
    throw error;
  }
  return rows.map((row) => {
    const metrics = metricsFrom(row);
    return {
      videoId: typeof row.video === "string" ? row.video : "",
      title:
        typeof row.video === "string" ? (titles.get(row.video) ?? null) : null,
      views: metrics?.views ?? null,
      estimatedMinutesWatched: metrics?.estimatedMinutesWatched ?? null,
      averageViewDuration: metrics?.averageViewDuration ?? null,
      subscribersGained: metrics?.subscribersGained ?? null,
      subscribersLost: metrics?.subscribersLost ?? null,
      likes: metrics?.likes ?? null,
      comments: metrics?.comments ?? null,
      shares: metrics?.shares ?? null,
    };
  });
}

async function getTopVideos(input: ReportInput) {
  const context = await ready(input.projectId);
  assertDataScope(context);
  const range = resolveYoutubeRange(input);
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
  const warnings = videos.length >= limit ? ["results_may_be_truncated"] : [];
  return {
    source: source(context),
    request: {
      startDate: range.startDate,
      endDate: range.endDate,
      limit,
    },
    rowCount: videos.length,
    rows: videos,
    warnings,
  };
}

async function dimensionReport<
  Row extends Record<string, string | number | null>,
>(
  input: ReportInput,
  query: Pick<YoutubeReportQuery, "dimensions" | "filters" | "sort">,
  mapRow: (row: YoutubeReportRow) => Row,
) {
  const context = await ready(input.projectId);
  const range = resolveYoutubeRange(input);
  const limit = rowLimit(input.limit);
  const rows = await callReport(context.client, {
    channelId: context.channelId,
    startDate: range.startDate,
    endDate: range.endDate,
    metrics: YOUTUBE_TRAFFIC_METRICS,
    maxResults: limit,
    ...query,
  });
  return {
    source: source(context),
    request: {
      startDate: range.startDate,
      endDate: range.endDate,
      limit,
    },
    rowCount: rows.length,
    rows: rows.map(mapRow),
    warnings: rows.length >= limit ? ["results_may_be_truncated"] : [],
  };
}

async function getTrafficSources(input: ReportInput) {
  return dimensionReport(
    input,
    { dimensions: ["insightTrafficSourceType"], sort: "-views" },
    (row) => ({
      trafficSource:
        typeof row.insightTrafficSourceType === "string"
          ? row.insightTrafficSourceType
          : "",
      views: metricValue(row, "views"),
      estimatedMinutesWatched: metricValue(row, "estimatedMinutesWatched"),
    }),
  );
}

async function getSearchTerms(input: ReportInput) {
  return dimensionReport(
    input,
    {
      dimensions: ["insightTrafficSourceDetail"],
      filters: ["insightTrafficSourceType==YT_SEARCH"],
      sort: "-views",
    },
    (row) => ({
      term:
        typeof row.insightTrafficSourceDetail === "string"
          ? row.insightTrafficSourceDetail
          : "",
      views: metricValue(row, "views"),
      estimatedMinutesWatched: metricValue(row, "estimatedMinutesWatched"),
    }),
  );
}

async function getVideoStats(input: ReportInput & { videoId: string }) {
  if (!YOUTUBE_VIDEO_ID.test(input.videoId)) {
    throw new YoutubeReportError(
      "validation_error",
      "videoId must be an 11-character YouTube video id.",
    );
  }
  const context = await ready(input.projectId);
  assertDataScope(context);
  const range = resolveYoutubeRange(input);
  const row = await oneRow(context, {
    channelId: context.channelId,
    startDate: range.startDate,
    endDate: range.endDate,
    metrics: YOUTUBE_OVERVIEW_METRICS,
    filters: [`video==${input.videoId}`],
  });
  const titles = await context.client
    .listVideoTitles([input.videoId])
    .catch((error: unknown) => {
      if (error instanceof YoutubeApiError)
        throw youtubeReportErrorFromApi(error);
      if (error instanceof YoutubeTokenError) {
        throw new YoutubeReportError(
          "youtube_reconnect_required",
          "The YouTube connection has expired or was revoked. Reconnect YouTube in project settings.",
        );
      }
      if (error instanceof YoutubeMalformedResponseError) {
        throw new YoutubeReportError(
          "youtube_malformed_response",
          error.message,
        );
      }
      throw error;
    });
  return {
    source: source(context),
    request: { startDate: range.startDate, endDate: range.endDate },
    videoId: input.videoId,
    title: titles.get(input.videoId) ?? null,
    current: metricsFrom(row),
    warnings: [] as string[],
  };
}

export const YoutubeReportingService = {
  getChannelOverview,
  getTopVideos,
  getTrafficSources,
  getSearchTerms,
  getVideoStats,
};
