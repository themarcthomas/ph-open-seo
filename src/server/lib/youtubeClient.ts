import { z } from "zod";
import { getGoogleAccessMode } from "@/server/features/google/googleAccess";
import { getGatewayGoogleFetch } from "@/server/features/google/gatewayGoogle";
import { getGoogleAccessToken } from "@/server/features/google/googleOAuth";
import {
  YoutubeApiError,
  YoutubeMalformedResponseError,
  YoutubeTokenError,
} from "@/server/lib/youtubeErrors";
import { YOUTUBE_OAUTH_PROVIDER_ID } from "@/shared/youtube";

const YOUTUBE_DATA_API = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const MAX_CHANNEL_PAGES = 20;
const VIDEO_TITLE_BATCH = 50;
const MAX_REPORT_ROWS = 200;

const channelListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        snippet: z
          .object({
            title: z.string().optional(),
            customUrl: z.string().optional(),
            thumbnails: z
              .object({
                high: z.object({ url: z.string() }).optional(),
                medium: z.object({ url: z.string() }).optional(),
                default: z.object({ url: z.string() }).optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

const videoListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const reportSchema = z.object({
  columnHeaders: z
    .array(
      z.object({
        name: z.string(),
        dataType: z.string().optional(),
      }),
    )
    .optional(),
  rows: z
    .array(z.array(z.union([z.string(), z.number(), z.null()])))
    .optional(),
});

const apiErrorSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      errors: z
        .array(
          z.object({
            reason: z.string().optional(),
            message: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

type YoutubeChannel = {
  channelId: string;
  title: string;
  customUrl: string | null;
  thumbnailUrl: string | null;
};

export type YoutubeReportQuery = {
  channelId: string;
  startDate: string;
  endDate: string;
  metrics: readonly string[];
  dimensions?: readonly string[];
  filters?: readonly string[];
  sort?: string;
  maxResults?: number;
};

export type YoutubeReportRow = Record<string, string | number | null>;

function httpsUrl(value: string | undefined): string | null {
  if (!value || !value.startsWith("https://")) return null;
  return value;
}

function thumbnailUrl(
  thumbnails:
    | {
        high?: { url: string };
        medium?: { url: string };
        default?: { url: string };
      }
    | undefined,
): string | null {
  return (
    httpsUrl(thumbnails?.medium?.url) ??
    httpsUrl(thumbnails?.high?.url) ??
    httpsUrl(thumbnails?.default?.url)
  );
}

function retryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function getYoutubeAccessToken(opts: {
  userId: string;
  youtubeAccountId: string;
}): Promise<string> {
  try {
    return await getGoogleAccessToken({
      providerId: YOUTUBE_OAUTH_PROVIDER_ID,
      userId: opts.userId,
      accountId: opts.youtubeAccountId,
    });
  } catch (error) {
    throw new YoutubeTokenError(
      "Could not mint a YouTube access token.",
      error,
    );
  }
}

type Authenticated = { fetch: typeof fetch; headers: Record<string, string> };

async function authenticateYoutube(opts: {
  userId: string;
  youtubeAccountId: string;
}): Promise<Authenticated> {
  if ((await getGoogleAccessMode()) === "gateway") {
    const gatewayFetch = await getGatewayGoogleFetch();
    if (!gatewayFetch) {
      throw new YoutubeTokenError(
        "Google isn't reachable through the Every App gateway here.",
      );
    }
    return { fetch: gatewayFetch, headers: {} };
  }
  return {
    fetch,
    headers: { Authorization: `Bearer ${await getYoutubeAccessToken(opts)}` },
  };
}

function cellValue(
  value: string | number | null,
  dataType: string | undefined,
): string | number | null {
  if (typeof value === "number" || value === null) return value;
  if (dataType === "INTEGER" || dataType === "FLOAT") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return value;
}

/**
 * Read-only YouTube Data API and YouTube Analytics API client.
 * `channels.list?mine=true` returns every channel the token can manage,
 * including Brand Account channels, so callers must keep the full list and
 * query Analytics with `channel==CHANNEL_ID` rather than `channel==MINE`.
 */
export function createYoutubeClient(opts: {
  userId: string;
  youtubeAccountId: string;
}) {
  let authenticated: Promise<Authenticated> | undefined;
  const access = () => (authenticated ??= authenticateYoutube(opts));

  async function request(url: string): Promise<unknown> {
    const { fetch: send, headers } = await access();
    let response: Response;
    try {
      response = await send(url, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new YoutubeApiError(0, "YouTube did not respond in time.");
      }
      throw error;
    }
    if (!response.ok) {
      let reason: string | null = null;
      try {
        const body = apiErrorSchema.parse(await response.json());
        reason = body.error?.errors?.[0]?.reason ?? null;
      } catch {
        reason = null;
      }
      throw new YoutubeApiError(
        response.status,
        `YouTube API error (${response.status}).`,
        reason,
        retryAfterSeconds(response),
      );
    }
    try {
      return await response.json();
    } catch {
      throw new YoutubeMalformedResponseError();
    }
  }

  return {
    async getUserInfoEmail(): Promise<string | null> {
      const data = z
        .object({ email: z.string().email().optional() })
        .parse(await request(GOOGLE_USERINFO_URL));
      return data.email ?? null;
    },

    async listChannels(): Promise<YoutubeChannel[]> {
      const channels: YoutubeChannel[] = [];
      let pageToken: string | undefined;
      const seenTokens = new Set<string>();
      for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
        const url = new URL(`${YOUTUBE_DATA_API}/channels`);
        url.searchParams.set("part", "snippet");
        url.searchParams.set("mine", "true");
        url.searchParams.set("maxResults", "50");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        let parsed: z.infer<typeof channelListSchema>;
        try {
          parsed = channelListSchema.parse(await request(url.toString()));
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw new YoutubeMalformedResponseError();
          }
          throw error;
        }
        for (const item of parsed.items ?? []) {
          channels.push({
            channelId: item.id,
            title: item.snippet?.title?.trim() || item.id,
            customUrl: item.snippet?.customUrl ?? null,
            thumbnailUrl: thumbnailUrl(item.snippet?.thumbnails),
          });
        }
        const next = parsed.nextPageToken;
        if (!next || seenTokens.has(next)) break;
        seenTokens.add(next);
        pageToken = next;
      }
      return channels;
    },

    async listVideoTitles(
      videoIds: readonly string[],
    ): Promise<Map<string, string>> {
      const titles = new Map<string, string>();
      for (let index = 0; index < videoIds.length; index += VIDEO_TITLE_BATCH) {
        const batch = videoIds.slice(index, index + VIDEO_TITLE_BATCH);
        if (batch.length === 0) continue;
        const url = new URL(`${YOUTUBE_DATA_API}/videos`);
        url.searchParams.set("part", "snippet");
        url.searchParams.set("id", batch.join(","));
        url.searchParams.set("maxResults", String(VIDEO_TITLE_BATCH));
        let parsed: z.infer<typeof videoListSchema>;
        try {
          parsed = videoListSchema.parse(await request(url.toString()));
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw new YoutubeMalformedResponseError();
          }
          throw error;
        }
        for (const item of parsed.items ?? []) {
          const title = item.snippet?.title?.trim();
          if (title) titles.set(item.id, title);
        }
      }
      return titles;
    },

    async queryReport(query: YoutubeReportQuery): Promise<YoutubeReportRow[]> {
      const url = new URL(`${YOUTUBE_ANALYTICS_API}/reports`);
      url.searchParams.set("ids", `channel==${query.channelId}`);
      url.searchParams.set("startDate", query.startDate);
      url.searchParams.set("endDate", query.endDate);
      url.searchParams.set("metrics", query.metrics.join(","));
      if (query.dimensions?.length) {
        url.searchParams.set("dimensions", query.dimensions.join(","));
      }
      if (query.filters?.length) {
        url.searchParams.set("filters", query.filters.join(";"));
      }
      if (query.sort) url.searchParams.set("sort", query.sort);
      if (query.maxResults !== undefined) {
        const maxResults = Math.min(
          MAX_REPORT_ROWS,
          Math.max(1, Math.floor(query.maxResults)),
        );
        url.searchParams.set("maxResults", String(maxResults));
      }
      let parsed: z.infer<typeof reportSchema>;
      try {
        parsed = reportSchema.parse(await request(url.toString()));
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new YoutubeMalformedResponseError();
        }
        throw error;
      }
      const headers = parsed.columnHeaders ?? [];
      return (parsed.rows ?? []).map((row) => {
        const record: YoutubeReportRow = {};
        headers.forEach((header, index) => {
          record[header.name] = cellValue(row[index] ?? null, header.dataType);
        });
        return record;
      });
    },
  };
}

export type YoutubeClient = ReturnType<typeof createYoutubeClient>;
