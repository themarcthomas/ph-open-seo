import {
  ga4DateInTimeZone,
  inclusiveGa4Days,
  shiftGa4Date,
} from "@/server/features/ga4/services/Ga4Dates";
import type { YoutubeReportRow } from "@/server/lib/youtubeClient";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import { YOUTUBE_REPORTING_TIME_ZONE } from "@/shared/youtube";

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

const DEFAULT_RANGE_DAYS = 28;
const DEFAULT_ROW_LIMIT = 25;
const MAX_ROW_LIMIT = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type YoutubeMetricName = (typeof YOUTUBE_OVERVIEW_METRICS)[number];
type YoutubeMetrics = Record<YoutubeMetricName, number | null>;

type YoutubeMetricComparison = {
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
};

type YoutubeDateRange = {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
};

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  return (
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}

function previousWindow(startDate: string, endDate: string) {
  const days = inclusiveGa4Days(startDate, endDate);
  const previousEndDate = shiftGa4Date(startDate, -1);
  const previousStartDate = shiftGa4Date(previousEndDate, -(days - 1));
  return { previousStartDate, previousEndDate };
}

export function resolveYoutubeRange(
  input: { startDate?: string; endDate?: string },
  now = new Date(),
): YoutubeDateRange {
  const hasStart = input.startDate !== undefined;
  const hasEnd = input.endDate !== undefined;
  if (hasStart !== hasEnd) {
    throw new YoutubeReportError(
      "validation_error",
      "Provide both startDate and endDate, or neither.",
    );
  }
  if (!input.startDate || !input.endDate) {
    const endDate = shiftGa4Date(
      ga4DateInTimeZone(now, YOUTUBE_REPORTING_TIME_ZONE),
      -1,
    );
    const startDate = shiftGa4Date(endDate, -(DEFAULT_RANGE_DAYS - 1));
    return { startDate, endDate, ...previousWindow(startDate, endDate) };
  }
  if (!isRealDate(input.startDate) || !isRealDate(input.endDate)) {
    throw new YoutubeReportError(
      "validation_error",
      "Dates must be real YYYY-MM-DD calendar days.",
    );
  }
  if (input.startDate > input.endDate) {
    throw new YoutubeReportError(
      "validation_error",
      "startDate must be on or before endDate.",
    );
  }
  return {
    startDate: input.startDate,
    endDate: input.endDate,
    ...previousWindow(input.startDate, input.endDate),
  };
}

export function rowLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_ROW_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROW_LIMIT) {
    throw new YoutubeReportError(
      "validation_error",
      `limit must be an integer from 1 through ${MAX_ROW_LIMIT}.`,
    );
  }
  return limit;
}

export function metricValue(
  row: YoutubeReportRow | undefined,
  name: string,
): number | null {
  const value = row?.[name];
  return typeof value === "number" ? value : null;
}

export function metricsFrom(
  row: YoutubeReportRow | undefined,
): YoutubeMetrics | null {
  if (!row) return null;
  return {
    views: metricValue(row, "views"),
    estimatedMinutesWatched: metricValue(row, "estimatedMinutesWatched"),
    averageViewDuration: metricValue(row, "averageViewDuration"),
    subscribersGained: metricValue(row, "subscribersGained"),
    subscribersLost: metricValue(row, "subscribersLost"),
    likes: metricValue(row, "likes"),
    comments: metricValue(row, "comments"),
    shares: metricValue(row, "shares"),
  };
}

function compareMetric(
  current: number | null,
  previous: number | null,
): YoutubeMetricComparison {
  if (current === null || previous === null) {
    return { current, previous, absoluteChange: null, percentChange: null };
  }
  const percentChange =
    previous === 0
      ? current === 0
        ? 0
        : null
      : (current - previous) / previous;
  return {
    current,
    previous,
    absoluteChange: current - previous,
    percentChange,
  };
}

export function compareMetrics(
  current: YoutubeMetrics | null,
  previous: YoutubeMetrics | null,
) {
  const field = (name: YoutubeMetricName) =>
    compareMetric(current?.[name] ?? null, previous?.[name] ?? null);
  return {
    views: field("views"),
    estimatedMinutesWatched: field("estimatedMinutesWatched"),
    averageViewDuration: field("averageViewDuration"),
    subscribersGained: field("subscribersGained"),
    subscribersLost: field("subscribersLost"),
    likes: field("likes"),
    comments: field("comments"),
    shares: field("shares"),
  };
}
