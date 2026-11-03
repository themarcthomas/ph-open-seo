import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { YoutubeReportingService } from "@/server/features/youtube/services/YoutubeReportingService";
import {
  YOUTUBE_OVERVIEW_METRICS,
  type YoutubeMetricChange,
  type YoutubeMetricName,
} from "@/server/features/youtube/services/YoutubeReportModel";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { looseObjectOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { formatMcpTable, type McpTableColumn } from "@/server/mcp/table";
import { buildDashboardUrl } from "@/server/mcp/urls";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Inclusive YYYY-MM-DD date. Provide both startDate and endDate.");

const dateInput = {
  projectId: projectIdSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
} as const;

const readOnly = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const;

const errorDetailSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    retryAfterSeconds: z.number().nullable().optional(),
    actionUrl: z.string().optional(),
  })
  .passthrough();

const RECONNECT_CODES = new Set([
  "youtube_not_connected",
  "youtube_reconnect_required",
  "youtube_scope_missing",
  "youtube_channel_inaccessible",
  "youtube_api_disabled",
]);

function youtubeEnvelope(okShape: Record<string, z.ZodType>) {
  const requiredOkFields = Object.entries(okShape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
  return z
    .object({
      status: z.enum(["ok", "error"]),
      ...Object.fromEntries(
        Object.entries(okShape).map(([key, field]) => [key, field.optional()]),
      ),
      error: errorDetailSchema.optional(),
    })
    .passthrough()
    .superRefine((value, ctx) => {
      if (value.status === "error") {
        if (value.error === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["error"],
            message: "error is required when status is error",
          });
        }
        return;
      }
      for (const key of requiredOkFields) {
        if ((value as Record<string, unknown>)[key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when status is ok`,
          });
        }
      }
    });
}

const overviewOutputSchema = youtubeEnvelope({
  source: looseObjectOutputSchema,
  request: looseObjectOutputSchema,
  current: looseObjectOutputSchema,
  previous: looseObjectOutputSchema,
  comparison: looseObjectOutputSchema,
  warnings: z.array(z.string()),
});

const rowsOutputSchema = youtubeEnvelope({
  source: looseObjectOutputSchema,
  request: looseObjectOutputSchema,
  rowCount: z.number(),
  rows: z.array(looseObjectOutputSchema),
  pageInfo: looseObjectOutputSchema.optional(),
  warnings: z.array(z.string()),
});

const videoOutputSchema = youtubeEnvelope({
  source: looseObjectOutputSchema,
  request: looseObjectOutputSchema,
  video: looseObjectOutputSchema,
  metrics: looseObjectOutputSchema,
  warnings: z.array(z.string()),
});

type ProjectArgs = { projectId: string };
type ProjectContext = { baseUrl: string };

function errorResponse(
  args: ProjectArgs,
  context: ProjectContext,
  error: unknown,
): CallToolResult {
  if (!(error instanceof YoutubeReportError)) throw error;
  const actionUrl = RECONNECT_CODES.has(error.code)
    ? buildDashboardUrl(
        context.baseUrl,
        `/p/${args.projectId}/settings/integrations`,
      )
    : undefined;
  return mcpResponse({
    text: `${error.message}${actionUrl ? ` Continue here: ${actionUrl}` : ""}`,
    meta: buildProjectMeta(context, args.projectId),
    structuredContent: {
      status: "error",
      error: {
        code: error.code,
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
        actionUrl,
      },
    },
  });
}

const METRIC_LABELS: Record<YoutubeMetricName, string> = {
  views: "Views",
  estimatedMinutesWatched: "Watch time (minutes)",
  averageViewDuration: "Avg view duration (seconds)",
  subscribersGained: "Subscribers gained",
  subscribersLost: "Subscribers lost",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
};

function formatChange(change: YoutubeMetricChange): string {
  const current = change.current ?? "—";
  const previous = change.previous ?? "—";
  const percent =
    change.percentChange === null
      ? ""
      : ` (${change.percentChange > 0 ? "+" : ""}${change.percentChange}%)`;
  return `${current} vs ${previous}${percent}`;
}

function overviewText(
  result: Awaited<
    ReturnType<typeof YoutubeReportingService.getChannelOverview>
  >,
) {
  const range = result.request.resolvedDateRange;
  const previous = result.request.previousDateRange;
  const lines = YOUTUBE_OVERVIEW_METRICS.map(
    (name) =>
      `${METRIC_LABELS[name]}: ${formatChange(result.comparison[name])}`,
  );
  const clamped = result.warnings.includes("end_date_clamped")
    ? ` The requested end date was moved back to ${range.endDate}, the last complete Pacific Time day.`
    : "";
  return [
    `${result.source.channelTitle} (${result.source.channelId}): ${range.startDate} through ${range.endDate}, compared with ${previous.startDate} through ${previous.endDate} (America/Los_Angeles).${clamped}`,
    ...lines,
  ].join("\n");
}

function tableText<T>(
  label: string,
  rows: readonly T[],
  columns: readonly McpTableColumn<T>[],
) {
  if (rows.length === 0) return `${label}: no rows.`;
  return `${label}:\n${formatMcpTable(rows, columns)}`;
}

async function guarded<T>(
  args: ProjectArgs,
  context: ProjectContext,
  run: () => Promise<T>,
  present: (result: T) => {
    text: string;
    structuredContent: Record<string, unknown>;
  },
) {
  try {
    const result = await run();
    const presented = present(result);
    return mcpResponse({
      text: presented.text,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: presented.structuredContent,
    });
  } catch (error) {
    return errorResponse(args, context, error);
  }
}

export const getYoutubeChannelOverviewTool = {
  name: "get_youtube_channel_overview",
  config: {
    title: "YouTube channel overview",
    description:
      "Reads a connected YouTube channel's views, watch time, average view duration, subscribers gained and lost, likes, comments, and shares for a date range, each compared with the previous period of the same length. Dates are Pacific Time (America/Los_Angeles); the default range is the last 28 complete days. Uses no credits. Read-only. Requires the project to have a YouTube channel connected.",
    inputSchema: dateInput,
    outputSchema: overviewOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args, context) =>
    guarded(
      args,
      context,
      () => YoutubeReportingService.getChannelOverview(args),
      (result) => ({
        text: overviewText(result),
        structuredContent: result,
      }),
    ),
  ),
};

const listInput = {
  ...dateInput,
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
} as const;

export const getYoutubeTopVideosTool = {
  name: "get_youtube_top_videos",
  config: {
    title: "YouTube top videos",
    description:
      "Lists a connected channel's top videos for a date range, with titles from the YouTube Data API. Ordered by views. limit is 1-50 (default 10). A video whose title YouTube no longer returns stays in the list with title null. Uses no credits. Read-only.",
    inputSchema: listInput,
    outputSchema: rowsOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args, context) =>
    guarded(
      args,
      context,
      () => YoutubeReportingService.getTopVideos(args),
      (result) => ({
        text: tableText("Top videos", result.rows, [
          { header: "videoId", value: (row) => row.videoId },
          { header: "title", value: (row) => row.title },
          { header: "views", value: (row) => row.views },
          {
            header: "watch minutes",
            value: (row) => row.estimatedMinutesWatched,
          },
          { header: "avg seconds", value: (row) => row.averageViewDuration },
          { header: "likes", value: (row) => row.likes },
          { header: "comments", value: (row) => row.comments },
          { header: "shares", value: (row) => row.shares },
        ]),
        structuredContent: result,
      }),
    ),
  ),
};

export const getYoutubeTrafficSourcesTool = {
  name: "get_youtube_traffic_sources",
  config: {
    title: "YouTube traffic sources",
    description:
      "Breaks a connected channel's views and watch time down by YouTube's insightTrafficSourceType for a date range. Ordered by views. limit is 1-50 (default 25). Uses no credits. Read-only.",
    inputSchema: {
      ...dateInput,
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: rowsOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args, context) =>
    guarded(
      args,
      context,
      () => YoutubeReportingService.getTrafficSources(args),
      (result) => ({
        text: tableText("Traffic sources", result.rows, [
          { header: "source", value: (row) => row.source },
          { header: "views", value: (row) => row.views },
          {
            header: "watch minutes",
            value: (row) => row.estimatedMinutesWatched,
          },
        ]),
        structuredContent: result,
      }),
    ),
  ),
};

export const getYoutubeSearchTermsTool = {
  name: "get_youtube_search_terms",
  config: {
    title: "YouTube search terms",
    description:
      "Lists YouTube Search terms (insightTrafficSourceDetail filtered to insightTrafficSourceType==YT_SEARCH) that sent views to a connected channel, with views and watch time. YouTube returns at most 25 terms. Dates default to the last 28 complete Pacific Time days. Uses no credits. Read-only.",
    inputSchema: {
      ...dateInput,
      limit: z.number().int().min(1).max(25).optional(),
    },
    outputSchema: rowsOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args, context) =>
    guarded(
      args,
      context,
      () => YoutubeReportingService.getSearchTerms(args),
      (result) => {
        const capped = result.warnings.includes("search_terms_capped")
          ? " YouTube caps this report at 25 terms."
          : "";
        return {
          text: `${tableText("YouTube search terms", result.rows, [
            { header: "term", value: (row) => row.term },
            { header: "views", value: (row) => row.views },
            {
              header: "watch minutes",
              value: (row) => row.estimatedMinutesWatched,
            },
          ])}${capped}`,
          structuredContent: result,
        };
      },
    ),
  ),
};

export const getYoutubeVideoStatsTool = {
  name: "get_youtube_video_stats",
  config: {
    title: "YouTube video stats",
    description:
      "Reads one video's views, watch time, average view duration, subscribers gained and lost, likes, comments, and shares on the channel connected to the project. videoId is the 11-character YouTube id. The video must belong to that channel. Uses no credits. Read-only.",
    inputSchema: {
      ...dateInput,
      videoId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{11}$/)
        .describe("11-character YouTube video id."),
    },
    outputSchema: videoOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (
      args: {
        projectId: string;
        videoId: string;
        startDate?: string;
        endDate?: string;
      },
      context,
    ) =>
      guarded(
        args,
        context,
        () => YoutubeReportingService.getVideoStats(args),
        (result) => ({
          text: [
            `${result.video.title} (${result.video.videoId}) on ${result.source.channelTitle}, ${result.request.resolvedDateRange.startDate} through ${result.request.resolvedDateRange.endDate}.`,
            ...YOUTUBE_OVERVIEW_METRICS.map(
              (name) =>
                `${METRIC_LABELS[name]}: ${result.metrics[name] ?? "—"}`,
            ),
          ].join("\n"),
          structuredContent: result,
        }),
      ),
  ),
};
