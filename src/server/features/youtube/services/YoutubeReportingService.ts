import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { getGoogleAccessMode } from "@/server/features/google/googleAccess";
import { YoutubeConnectionRepository } from "@/server/features/youtube/repositories/YoutubeConnectionRepository";
import {
  comparisonOf,
  mapYoutubeReportError,
  metricsFromRow,
  normalizeYoutubeLimit,
  normalizeYoutubeOffset,
  resolveYoutubeDateRange,
  VIDEO_ID_PATTERN,
  youtubeNumberCell,
  YOUTUBE_OVERVIEW_METRICS,
  YOUTUBE_TRAFFIC_METRICS,
  type YoutubeDateInput,
} from "@/server/features/youtube/services/YoutubeReportModel";
import {
  createYoutubeClient,
  type YoutubeAnalyticsQuery,
} from "@/server/lib/youtubeClient";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import {
  YOUTUBE_OAUTH_PROVIDER_ID,
  youtubeGrantIsMissingScope,
} from "@/shared/youtube";

async function assertStoredScope(input: { userId: string; accountId: string }) {
  if ((await getGoogleAccessMode()) === "gateway") return;
  const [grant] = await db
    .select({ scope: account.scope })
    .from(account)
    .where(
      and(
        eq(account.userId, input.userId),
        eq(account.providerId, YOUTUBE_OAUTH_PROVIDER_ID),
        eq(account.accountId, input.accountId),
      ),
    )
    .limit(1);
  if (!grant) {
    throw new YoutubeReportError(
      "youtube_reconnect_required",
      "The YouTube connection has expired or was revoked.",
    );
  }
  if (youtubeGrantIsMissingScope(grant.scope)) {
    throw new YoutubeReportError(
      "youtube_scope_missing",
      "The YouTube connection is missing the YouTube Analytics or YouTube read-only permission. Reconnect and approve both.",
    );
  }
}

async function requireConnection(projectId: string) {
  const connection =
    await YoutubeConnectionRepository.getByProjectId(projectId);
  if (!connection) {
    throw new YoutubeReportError(
      "youtube_not_connected",
      "YouTube is not connected for this project.",
    );
  }
  await assertStoredScope({
    userId: connection.connectedByUserId,
    accountId: connection.youtubeAccountId,
  });
  return connection;
}

function clientFor(connection: {
  connectedByUserId: string;
  youtubeAccountId: string;
}) {
  return createYoutubeClient({
    userId: connection.connectedByUserId,
    youtubeAccountId: connection.youtubeAccountId,
  });
}

async function runQuery(
  client: ReturnType<typeof createYoutubeClient>,
  query: YoutubeAnalyticsQuery,
) {
  try {
    return await client.query(query);
  } catch (error) {
    mapYoutubeReportError(error);
  }
}

function sourceOf(connection: { channelId: string; channelTitle: string }) {
  return {
    provider: "youtube" as const,
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
  };
}

function pageInfo(offset: number, limit: number, rowCount: number) {
  const hasMore = rowCount === limit;
  return {
    offset,
    limit,
    hasMore,
    nextOffset: hasMore ? offset + rowCount : null,
  };
}

async function getChannelOverview(
  input: YoutubeDateInput & { projectId: string },
  now = new Date(),
) {
  const connection = await requireConnection(input.projectId);
  const dates = resolveYoutubeDateRange(input, now);
  const client = clientFor(connection);
  const base = {
    channelId: connection.channelId,
    metrics: YOUTUBE_OVERVIEW_METRICS,
  };
  const [currentRows, previousRows] = await Promise.all([
    runQuery(client, { ...base, ...dates.resolvedDateRange }),
    runQuery(client, { ...base, ...dates.previousDateRange }),
  ]);
  const current = metricsFromRow(currentRows[0]);
  const previous = metricsFromRow(previousRows[0]);
  return {
    status: "ok" as const,
    source: sourceOf(connection),
    request: dates,
    current,
    previous,
    comparison: comparisonOf(current, previous),
    warnings: dates.warnings,
  };
}

async function getTopVideos(
  input: YoutubeDateInput & {
    projectId: string;
    limit?: number;
    offset?: number;
  },
  now = new Date(),
) {
  const connection = await requireConnection(input.projectId);
  const dates = resolveYoutubeDateRange(input, now);
  const limit = normalizeYoutubeLimit(input.limit, 50, 10);
  const offset = normalizeYoutubeOffset(input.offset);
  const client = clientFor(connection);
  const rows = await runQuery(client, {
    channelId: connection.channelId,
    ...dates.resolvedDateRange,
    metrics: YOUTUBE_OVERVIEW_METRICS,
    dimensions: ["video"],
    sort: "-views",
    maxResults: limit,
    startIndex: offset + 1,
  });
  const videoIds = rows.flatMap((row) =>
    typeof row.video === "string" ? [row.video] : [],
  );
  let titles: Awaited<ReturnType<typeof client.listVideos>> = [];
  try {
    titles = await client.listVideos(videoIds);
  } catch (error) {
    mapYoutubeReportError(error);
  }
  const titleById = new Map(
    titles.map((video) => [video.videoId, video.title]),
  );
  return {
    status: "ok" as const,
    source: sourceOf(connection),
    request: dates,
    rowCount: rows.length,
    rows: rows.map((row) => ({
      videoId: typeof row.video === "string" ? row.video : null,
      title:
        typeof row.video === "string"
          ? (titleById.get(row.video) ?? null)
          : null,
      ...metricsFromRow(row),
    })),
    pageInfo: pageInfo(offset, limit, rows.length),
    warnings: dates.warnings,
  };
}

async function dimensionReport(
  input: YoutubeDateInput & { projectId: string; limit?: number },
  report: {
    dimensions: readonly string[];
    filters?: string;
    max: number;
    fallback: number;
    cappedWarning?: string;
  },
  now = new Date(),
) {
  const connection = await requireConnection(input.projectId);
  const dates = resolveYoutubeDateRange(input, now);
  const limit = normalizeYoutubeLimit(input.limit, report.max, report.fallback);
  const client = clientFor(connection);
  const rows = await runQuery(client, {
    channelId: connection.channelId,
    ...dates.resolvedDateRange,
    metrics: YOUTUBE_TRAFFIC_METRICS,
    dimensions: report.dimensions,
    filters: report.filters,
    sort: "-views",
    maxResults: limit,
  });
  const warnings = [...dates.warnings];
  if (report.cappedWarning && rows.length === report.max) {
    warnings.push(report.cappedWarning);
  }
  return { connection, dates, rows, warnings, limit };
}

async function getTrafficSources(
  input: YoutubeDateInput & { projectId: string; limit?: number },
  now = new Date(),
) {
  const { connection, dates, rows, warnings, limit } = await dimensionReport(
    input,
    { dimensions: ["insightTrafficSourceType"], max: 50, fallback: 25 },
    now,
  );
  return {
    status: "ok" as const,
    source: sourceOf(connection),
    request: dates,
    rowCount: rows.length,
    rows: rows.map((row) => ({
      source:
        typeof row.insightTrafficSourceType === "string"
          ? row.insightTrafficSourceType
          : null,
      views: youtubeNumberCell(row, "views"),
      estimatedMinutesWatched: youtubeNumberCell(
        row,
        "estimatedMinutesWatched",
      ),
    })),
    pageInfo: pageInfo(0, limit, rows.length),
    warnings,
  };
}

async function getSearchTerms(
  input: YoutubeDateInput & { projectId: string; limit?: number },
  now = new Date(),
) {
  const { connection, dates, rows, warnings } = await dimensionReport(
    input,
    {
      dimensions: ["insightTrafficSourceDetail"],
      filters: "insightTrafficSourceType==YT_SEARCH",
      max: 25,
      fallback: 25,
      cappedWarning: "search_terms_capped",
    },
    now,
  );
  return {
    status: "ok" as const,
    source: sourceOf(connection),
    request: { ...dates, filter: "insightTrafficSourceType==YT_SEARCH" },
    rowCount: rows.length,
    rows: rows.map((row) => ({
      term:
        typeof row.insightTrafficSourceDetail === "string"
          ? row.insightTrafficSourceDetail
          : null,
      views: youtubeNumberCell(row, "views"),
      estimatedMinutesWatched: youtubeNumberCell(
        row,
        "estimatedMinutesWatched",
      ),
    })),
    warnings,
  };
}

async function getVideoStats(
  input: YoutubeDateInput & { projectId: string; videoId: string },
  now = new Date(),
) {
  if (!VIDEO_ID_PATTERN.test(input.videoId)) {
    throw new YoutubeReportError(
      "validation_error",
      "videoId must be an 11-character YouTube video id.",
    );
  }
  const connection = await requireConnection(input.projectId);
  const dates = resolveYoutubeDateRange(input, now);
  const client = clientFor(connection);
  let videos: Awaited<ReturnType<typeof client.listVideos>> = [];
  try {
    videos = await client.listVideos([input.videoId]);
  } catch (error) {
    mapYoutubeReportError(error);
  }
  const video = videos[0];
  if (!video) {
    throw new YoutubeReportError(
      "youtube_video_not_found",
      "YouTube has no video with that id.",
    );
  }
  if (video.channelId !== connection.channelId) {
    throw new YoutubeReportError(
      "youtube_video_not_in_channel",
      "That video is not on the YouTube channel connected to this project.",
    );
  }
  const rows = await runQuery(client, {
    channelId: connection.channelId,
    ...dates.resolvedDateRange,
    metrics: YOUTUBE_OVERVIEW_METRICS,
    filters: `video==${input.videoId}`,
  });
  return {
    status: "ok" as const,
    source: sourceOf(connection),
    request: dates,
    video: { videoId: video.videoId, title: video.title },
    metrics: metricsFromRow(rows[0]),
    warnings: dates.warnings,
  };
}

export const YoutubeReportingService = {
  getChannelOverview,
  getTopVideos,
  getTrafficSources,
  getSearchTerms,
  getVideoStats,
};
