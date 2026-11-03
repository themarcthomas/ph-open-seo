import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { YoutubeReportingService } from "@/server/features/youtube/services/YoutubeReportingService";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { looseObjectOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  formatMcpCell,
  formatMcpTable,
  percentCell,
  type McpTableColumn,
} from "@/server/mcp/table";
import { buildDashboardUrl } from "@/server/mcp/urls";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Inclusive YYYY-MM-DD date. Provide both startDate and endDate.");

const rangeSchema = {
  projectId: projectIdSchema,
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
} as const;

const rowRangeSchema = {
  ...rangeSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(25)
    .describe("Maximum rows, from 1 through 200. Defaults to 25."),
} as const;

const errorDetailSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    retryAfterSeconds: z.number().nullable().optional(),
    actionUrl: z.string().optional(),
  })
  .passthrough();

function envelope(okShape: Record<string, z.ZodType>) {
  const requiredOkFields = Object.entries(okShape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
  const optionalShape = Object.fromEntries(
    Object.entries(okShape).map(([key, field]) => [key, field.optional()]),
  );
  return z
    .object({
      status: z.enum(["ok", "error"]),
      ...optionalShape,
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

const overviewOutputSchema = envelope({
  source: looseObjectOutputSchema,
  request: looseObjectOutputSchema,
  current: looseObjectOutputSchema.nullable(),
  previous: looseObjectOutputSchema.nullable(),
  comparison: looseObjectOutputSchema,
  warnings: z.array(z.string()),
});

const rowsOutputSchema = envelope({
  source: looseObjectOutputSchema,
  request: looseObjectOutputSchema,
  rowCount: z.number(),
  rows: z.array(z.record(z.string(), z.unknown())),
  warnings: z.array(z.string()),
});

const videoOutputSchema = envelope({
  source: looseObjectOutputSchema,
  request: looseObjectOutputSchema,
  videoId: z.string(),
  title: z.string().nullable(),
  current: looseObjectOutputSchema.nullable(),
  warnings: z.array(z.string()),
});

const SETTINGS_CODES = new Set([
  "youtube_not_connected",
  "youtube_reconnect_required",
  "youtube_scope_missing",
  "youtube_channel_inaccessible",
  "youtube_api_disabled",
]);

type ProjectArgs = { projectId: string };
type ProjectContext = {
  auth: { organizationId: string };
  baseUrl: string;
  project: unknown;
};

function errorResponse(
  args: ProjectArgs,
  context: ProjectContext,
  error: unknown,
): CallToolResult {
  if (!(error instanceof YoutubeReportError)) throw error;
  const actionUrl = SETTINGS_CODES.has(error.code)
    ? buildDashboardUrl(
        context.baseUrl,
        `/p/${args.projectId}/settings/integrations#youtube`,
      )
    : undefined;
  return mcpResponse({
    text: `${error.message}${actionUrl ? ` Continue here: ${actionUrl}` : ""}`,
    meta: buildProjectMeta(context, args.projectId),
    structuredContent: {
      status: "error" as const,
      error: {
        code: error.code,
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
        actionUrl,
      },
    },
  });
}

const OVERVIEW_COLUMNS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "comments",
  "shares",
] as const;

function delta(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  const row = value as {
    current?: number | null;
    previous?: number | null;
    percentChange?: number | null;
  };
  const change =
    typeof row.percentChange === "number"
      ? ` (${row.percentChange > 0 ? "+" : ""}${percentCell(row.percentChange)})`
      : "";
  return `${formatMcpCell(row.current)} vs ${formatMcpCell(row.previous)}${change}`;
}

function rangeLabel(request: { startDate?: string; endDate?: string }) {
  return `${request.startDate} through ${request.endDate}`;
}

const readOnly = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const;

const sharedDescription =
  "Reads only the YouTube channel already connected to an OpenSEO project the caller is authorized to access. The server selects the Google account and channel from that project's saved connection. Read-only and uses no OpenSEO credits. Dates are inclusive calendar dates in America/Los_Angeles. Omit both dates for the last 28 complete days.";

export const getYoutubeChannelOverviewTool = {
  name: "get_youtube_channel_overview",
  config: {
    title: "Get YouTube channel overview",
    description: `Channel totals for views, estimated minutes watched, average view duration, subscribers gained and lost, likes, comments, and shares, with the same metrics for the previous period of equal length. ${sharedDescription}`,
    inputSchema: z.strictObject(rangeSchema),
    outputSchema: overviewOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args, context) => {
    try {
      const result = await YoutubeReportingService.getChannelOverview(args);
      const columns: McpTableColumn<(typeof OVERVIEW_COLUMNS)[number]>[] = [
        { header: "metric", value: (metric) => metric },
        {
          header: "current vs previous",
          value: (metric) => result.comparison[metric],
          format: delta,
        },
      ];
      const text = `YouTube channel ${result.source.channelTitle} (${result.source.channelId}), ${rangeLabel(result.request)} compared with ${result.request.previousStartDate} through ${result.request.previousEndDate}. Dates use ${result.source.timeZone}.\n${formatMcpTable([...OVERVIEW_COLUMNS], columns)}`;
      return mcpResponse({
        text,
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: { status: "ok" as const, ...result },
      });
    } catch (error) {
      return errorResponse(args, context, error);
    }
  }),
};

export const getYoutubeTopVideosTool = {
  name: "get_youtube_top_videos",
  config: {
    title: "Get YouTube top videos",
    description: `Top videos on the connected channel by views, with titles and the channel overview metrics. ${sharedDescription}`,
    inputSchema: z.strictObject(rowRangeSchema),
    outputSchema: rowsOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args, context) => {
    try {
      const result = await YoutubeReportingService.getTopVideos(args);
      const columns: McpTableColumn<(typeof result.rows)[number]>[] = [
        { header: "title", value: (row) => row?.title },
        { header: "videoId", value: (row) => row?.videoId },
        { header: "views", value: (row) => row?.views },
        {
          header: "estimatedMinutesWatched",
          value: (row) => row?.estimatedMinutesWatched,
        },
        {
          header: "averageViewDuration",
          value: (row) => row?.averageViewDuration,
        },
      ];
      const truncated = result.warnings.includes("results_may_be_truncated")
        ? " More videos may exist above this limit."
        : "";
      return mcpResponse({
        text: `Top ${result.rowCount} videos for ${result.source.channelTitle}, ${rangeLabel(result.request)}.${truncated}\n${formatMcpTable(result.rows, columns)}`,
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: { status: "ok" as const, ...result },
      });
    } catch (error) {
      return errorResponse(args, context, error);
    }
  }),
};

export const getYoutubeTrafficSourcesTool = {
  name: "get_youtube_traffic_sources",
  config: {
    title: "Get YouTube traffic sources",
    description: `Views and estimated minutes watched by YouTube traffic source (insightTrafficSourceType). ${sharedDescription}`,
    inputSchema: z.strictObject(rowRangeSchema),
    outputSchema: rowsOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args, context) => {
    try {
      const result = await YoutubeReportingService.getTrafficSources(args);
      const columns: McpTableColumn<(typeof result.rows)[number]>[] = [
        { header: "trafficSource", value: (row) => row.trafficSource },
        { header: "views", value: (row) => row.views },
        {
          header: "estimatedMinutesWatched",
          value: (row) => row.estimatedMinutesWatched,
        },
      ];
      return mcpResponse({
        text: `YouTube traffic sources for ${result.source.channelTitle}, ${rangeLabel(result.request)}.\n${formatMcpTable(result.rows, columns)}`,
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: { status: "ok" as const, ...result },
      });
    } catch (error) {
      return errorResponse(args, context, error);
    }
  }),
};

export const getYoutubeSearchTermsTool = {
  name: "get_youtube_search_terms",
  config: {
    title: "Get YouTube search terms",
    description: `YouTube Search terms that sent viewers to the channel (insightTrafficSourceDetail filtered to YT_SEARCH), with views and estimated minutes watched. ${sharedDescription}`,
    inputSchema: z.strictObject(rowRangeSchema),
    outputSchema: rowsOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(async (args, context) => {
    try {
      const result = await YoutubeReportingService.getSearchTerms(args);
      const columns: McpTableColumn<(typeof result.rows)[number]>[] = [
        { header: "term", value: (row) => row.term },
        { header: "views", value: (row) => row.views },
        {
          header: "estimatedMinutesWatched",
          value: (row) => row.estimatedMinutesWatched,
        },
      ];
      return mcpResponse({
        text: `YouTube search terms for ${result.source.channelTitle}, ${rangeLabel(result.request)}.\n${formatMcpTable(result.rows, columns)}`,
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: { status: "ok" as const, ...result },
      });
    } catch (error) {
      return errorResponse(args, context, error);
    }
  }),
};

const videoInputSchema = z.strictObject({
  ...rangeSchema,
  videoId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/)
    .describe("11-character YouTube video id."),
});

export const getYoutubeVideoStatsTool = {
  name: "get_youtube_video_stats",
  config: {
    title: "Get YouTube video stats",
    description: `Views, watch time, average view duration, subscribers gained and lost, likes, comments, and shares for one video on the connected channel, plus its title. ${sharedDescription}`,
    inputSchema: videoInputSchema,
    outputSchema: videoOutputSchema,
    annotations: readOnly,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<typeof videoInputSchema>, context) => {
      try {
        const result = await YoutubeReportingService.getVideoStats(args);
        const current = result.current;
        const lines = OVERVIEW_COLUMNS.map(
          (metric) => `${metric}: ${formatMcpCell(current?.[metric])}`,
        ).join("\n");
        return mcpResponse({
          text: `${result.title ?? result.videoId} (${result.videoId}) on ${result.source.channelTitle}, ${rangeLabel(result.request)}.\n${lines}`,
          meta: buildProjectMeta(context, args.projectId),
          structuredContent: { status: "ok" as const, ...result },
        });
      } catch (error) {
        return errorResponse(args, context, error);
      }
    },
  ),
};
