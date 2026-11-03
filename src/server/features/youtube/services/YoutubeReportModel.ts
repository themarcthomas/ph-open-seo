import { z } from "zod";
import {
  previousYoutubeRange,
  shiftYoutubeDate,
  youtubeDateInTimeZone,
} from "@/server/features/youtube/services/YoutubeDates";
import type { YoutubeReportRow } from "@/server/lib/youtubeClient";
import {
  YoutubeApiError,
  YoutubeMalformedResponseError,
  YoutubeReportError,
  YoutubeTokenError,
} from "@/server/lib/youtubeErrors";
import { YOUTUBE_REPORTING_TIME_ZONE } from "@/shared/youtube";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export const YOUTUBE_OVERVIEW_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "comments",
  "shares",
] as const;

export const YOUTUBE_TRAFFIC_METRICS = [
  "views",
  "estimatedMinutesWatched",
] as const;

export type YoutubeMetricName = (typeof YOUTUBE_OVERVIEW_METRICS)[number];
type YoutubeMetrics = Record<YoutubeMetricName, number | null>;
export type YoutubeMetricChange = {
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
};

export type YoutubeDateInput = { startDate?: string; endDate?: string };

const API_DISABLED_REASONS = new Set([
  "accessNotConfigured",
  "SERVICE_DISABLED",
]);

function parseDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function resolveYoutubeDateRange(
  input: YoutubeDateInput,
  now = new Date(),
) {
  if (Boolean(input.startDate) !== Boolean(input.endDate)) {
    throw new YoutubeReportError(
      "validation_error",
      "Provide both startDate and endDate, or neither.",
    );
  }
  const requestedDateRange =
    input.startDate && input.endDate
      ? { startDate: input.startDate, endDate: input.endDate }
      : null;
  if (
    requestedDateRange &&
    (!parseDate(requestedDateRange.startDate) ||
      !parseDate(requestedDateRange.endDate) ||
      requestedDateRange.startDate > requestedDateRange.endDate)
  ) {
    throw new YoutubeReportError(
      "validation_error",
      "Dates must be valid YYYY-MM-DD values with startDate on or before endDate.",
    );
  }

  const lastCompleteDay = shiftYoutubeDate(
    youtubeDateInTimeZone(now, YOUTUBE_REPORTING_TIME_ZONE),
    -1,
  );
  let endDate = requestedDateRange?.endDate ?? lastCompleteDay;
  const startDate =
    requestedDateRange?.startDate ?? shiftYoutubeDate(endDate, -27);
  const warnings: string[] = [];
  if (endDate > lastCompleteDay) {
    endDate = lastCompleteDay;
    warnings.push("end_date_clamped");
  }
  if (startDate > endDate) {
    throw new YoutubeReportError(
      "validation_error",
      "The resolved startDate is after the last complete YouTube day.",
    );
  }
  const resolvedDateRange = { startDate, endDate };
  return {
    requestedDateRange,
    resolvedDateRange,
    previousDateRange: previousYoutubeRange(startDate, endDate),
    warnings,
    timeZone: YOUTUBE_REPORTING_TIME_ZONE,
  };
}

export function normalizeYoutubeLimit(
  value: number | undefined,
  max: number,
  fallback: number,
) {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new YoutubeReportError(
      "validation_error",
      `limit must be an integer from 1 to ${max}.`,
    );
  }
  return limit;
}

export function normalizeYoutubeOffset(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new YoutubeReportError(
      "validation_error",
      "offset must be a non-negative integer.",
    );
  }
  return offset;
}

export function youtubeNumberCell(
  row: YoutubeReportRow | undefined,
  name: string,
): number | null {
  const value = row?.[name];
  return typeof value === "number" ? value : null;
}

export function metricsFromRow(
  row: YoutubeReportRow | undefined,
): YoutubeMetrics {
  return {
    views: youtubeNumberCell(row, "views"),
    estimatedMinutesWatched: youtubeNumberCell(row, "estimatedMinutesWatched"),
    averageViewDuration: youtubeNumberCell(row, "averageViewDuration"),
    subscribersGained: youtubeNumberCell(row, "subscribersGained"),
    subscribersLost: youtubeNumberCell(row, "subscribersLost"),
    likes: youtubeNumberCell(row, "likes"),
    comments: youtubeNumberCell(row, "comments"),
    shares: youtubeNumberCell(row, "shares"),
  };
}

function metricChange(
  current: number | null,
  previous: number | null,
): YoutubeMetricChange {
  if (current === null || previous === null) {
    return { current, previous, absoluteChange: null, percentChange: null };
  }
  const absoluteChange = current - previous;
  const percentChange =
    previous === 0
      ? current === 0
        ? 0
        : null
      : Math.round((absoluteChange / previous) * 1000) / 10;
  return { current, previous, absoluteChange, percentChange };
}

export function comparisonOf(
  current: YoutubeMetrics,
  previous: YoutubeMetrics,
) {
  return {
    views: metricChange(current.views, previous.views),
    estimatedMinutesWatched: metricChange(
      current.estimatedMinutesWatched,
      previous.estimatedMinutesWatched,
    ),
    averageViewDuration: metricChange(
      current.averageViewDuration,
      previous.averageViewDuration,
    ),
    subscribersGained: metricChange(
      current.subscribersGained,
      previous.subscribersGained,
    ),
    subscribersLost: metricChange(
      current.subscribersLost,
      previous.subscribersLost,
    ),
    likes: metricChange(current.likes, previous.likes),
    comments: metricChange(current.comments, previous.comments),
    shares: metricChange(current.shares, previous.shares),
  };
}

function isScopeReason(reason: string | null): boolean {
  return (
    reason === "insufficientPermissions" ||
    reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
    reason === "insufficient_scope"
  );
}

function isScopeProblem(error: YoutubeApiError): boolean {
  if (isScopeReason(error.reason)) return true;
  const message = error.message.toLowerCase();
  return message.includes("insufficient") && message.includes("scope");
}

function isApiDisabled(error: YoutubeApiError): boolean {
  if (error.status !== 403 || !error.reason) return false;
  if (isScopeProblem(error)) return false;
  return (
    API_DISABLED_REASONS.has(error.reason) ||
    error.message.toLowerCase().includes("has not been used") ||
    error.message.toLowerCase().includes("is disabled")
  );
}

export function mapYoutubeReportError(error: unknown): never {
  if (error instanceof YoutubeReportError) throw error;
  if (error instanceof YoutubeTokenError) {
    throw new YoutubeReportError(
      "youtube_reconnect_required",
      "The YouTube connection has expired or was revoked.",
    );
  }
  if (
    error instanceof YoutubeMalformedResponseError ||
    error instanceof z.ZodError
  ) {
    throw new YoutubeReportError(
      "youtube_malformed_response",
      "YouTube returned an invalid report.",
    );
  }
  if (error instanceof YoutubeApiError) {
    if (error.status === 401) {
      throw new YoutubeReportError(
        "youtube_reconnect_required",
        "The YouTube connection has expired or was revoked.",
      );
    }
    if (isScopeProblem(error)) {
      throw new YoutubeReportError(
        "youtube_scope_missing",
        "The YouTube connection is missing the YouTube Analytics or YouTube read-only permission. Reconnect and approve both.",
      );
    }
    if (isApiDisabled(error)) {
      throw new YoutubeReportError(
        "youtube_api_disabled",
        "Enable the YouTube Analytics API and YouTube Data API v3 on the Google Cloud project that owns this OAuth client.",
      );
    }
    if (error.status === 403 || error.status === 404) {
      throw new YoutubeReportError(
        "youtube_channel_inaccessible",
        "The connected Google account can no longer access this YouTube channel.",
      );
    }
    if (error.status === 400) {
      throw new YoutubeReportError(
        "youtube_channel_inaccessible",
        "YouTube rejected this report for the connected channel.",
      );
    }
    if (error.status === 429) {
      throw new YoutubeReportError(
        "youtube_quota_exhausted",
        "YouTube reporting quota is exhausted. Try again later.",
        error.retryAfterSeconds,
      );
    }
    throw new YoutubeReportError(
      "youtube_upstream_unavailable",
      "YouTube reporting is temporarily unavailable.",
    );
  }
  throw error;
}
