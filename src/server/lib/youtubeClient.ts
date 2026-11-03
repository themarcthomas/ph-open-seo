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
const MAX_CHANNEL_PAGES = 10;
const MAX_ERROR_BODY_LENGTH = 8_000;

const thumbnailSchema = z.object({ url: z.string().optional() }).optional();

const channelItemSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    title: z.string(),
    customUrl: z.string().optional(),
    thumbnails: z
      .object({
        default: thumbnailSchema,
        medium: thumbnailSchema,
        high: thumbnailSchema,
      })
      .optional(),
  }),
});

const channelsResponseSchema = z.object({
  items: z.array(channelItemSchema).optional(),
  nextPageToken: z.string().optional(),
});

const videoItemSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    title: z.string(),
    channelId: z.string(),
  }),
});

const videosResponseSchema = z.object({
  items: z.array(videoItemSchema).optional(),
});

const analyticsResponseSchema = z.object({
  columnHeaders: z
    .array(
      z.object({
        name: z.string(),
        columnType: z.string().optional(),
        dataType: z.string().optional(),
      }),
    )
    .optional(),
  rows: z
    .array(z.array(z.union([z.string(), z.number(), z.null()])))
    .optional(),
});

const googleErrorSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      status: z.string().optional(),
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

type YoutubeChannelSummary = {
  channelId: string;
  title: string;
  customUrl: string | null;
  thumbnailUrl: string | null;
};

type YoutubeVideoSummary = {
  videoId: string;
  title: string;
  channelId: string;
};

export type YoutubeAnalyticsQuery = {
  channelId: string;
  startDate: string;
  endDate: string;
  metrics: readonly string[];
  dimensions?: readonly string[];
  filters?: string;
  sort?: string;
  maxResults?: number;
  startIndex?: number;
};

export type YoutubeReportRow = Record<string, string | number | null>;

type Authenticated = { fetch: typeof fetch; headers: Record<string, string> };

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

async function readError(response: Response): Promise<{
  reason: string | null;
  message: string;
}> {
  const text = (await response.text()).slice(0, MAX_ERROR_BODY_LENGTH);
  const parsed = googleErrorSchema.safeParse(text ? safeJson(text) : undefined);
  const error = parsed.success ? parsed.data.error : undefined;
  const reason = error?.errors?.[0]?.reason ?? error?.status ?? null;
  return {
    reason,
    message:
      error?.errors?.[0]?.message ??
      error?.message ??
      `YouTube API error (${response.status}).`,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function messageForStatus(status: number, fallback: string): string {
  if (status === 401) return "YouTube connection expired.";
  if (status === 403) return fallback;
  if (status === 429) return "YouTube rate limit reached.";
  return fallback;
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

async function authenticate(opts: {
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

function memoizedAccess(opts: { userId: string; youtubeAccountId: string }) {
  let authenticated: Promise<Authenticated> | undefined;
  return () => (authenticated ??= authenticate(opts));
}

function cellValue(
  value: string | number | null,
  columnType: string | undefined,
): string | number | null {
  if (value === null) return null;
  if (columnType === "DIMENSION") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : String(value);
}

function rowsFromAnalytics(
  body: z.infer<typeof analyticsResponseSchema>,
): YoutubeReportRow[] {
  const headers = body.columnHeaders ?? [];
  if (headers.length === 0) {
    if ((body.rows ?? []).length === 0) return [];
    throw new YoutubeMalformedResponseError();
  }
  return (body.rows ?? []).map((row) => {
    if (row.length !== headers.length)
      throw new YoutubeMalformedResponseError();
    const record: YoutubeReportRow = {};
    headers.forEach((header, index) => {
      const value = row[index];
      record[header.name] =
        value === undefined ? null : cellValue(value, header.columnType);
    });
    return record;
  });
}

function channelSummary(
  item: z.infer<typeof channelItemSchema>,
): YoutubeChannelSummary {
  const thumbnails = item.snippet.thumbnails;
  return {
    channelId: item.id,
    title: item.snippet.title,
    customUrl: item.snippet.customUrl ?? null,
    thumbnailUrl:
      thumbnails?.medium?.url ??
      thumbnails?.default?.url ??
      thumbnails?.high?.url ??
      null,
  };
}

export function createYoutubeClient(opts: {
  userId: string;
  youtubeAccountId: string;
}) {
  const access = memoizedAccess(opts);

  async function request(url: string): Promise<unknown> {
    const { fetch: send, headers } = await access();
    let response: Response;
    try {
      response = await send(url, { headers });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new YoutubeApiError(
        0,
        "YouTube is temporarily unavailable.",
        "network",
      );
    }
    if (!response.ok) {
      const details = await readError(response);
      throw new YoutubeApiError(
        response.status,
        messageForStatus(response.status, details.message),
        details.reason,
        retryAfterSeconds(response),
      );
    }
    return response.json();
  }

  return {
    async getUserInfoEmail(): Promise<string | null> {
      const data = z
        .object({ email: z.string().email().optional() })
        .parse(await request(GOOGLE_USERINFO_URL));
      return data.email ?? null;
    },

    /** `channels.list?mine=true`, including later pages. Brand Account
     *  channels are returned when that account was selected at consent, and
     *  channels without statistics (hidden subscriber counts) are kept. */
    async listChannels(): Promise<YoutubeChannelSummary[]> {
      const channels: YoutubeChannelSummary[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
        const url = new URL(`${YOUTUBE_DATA_API}/channels`);
        url.searchParams.set("part", "snippet");
        url.searchParams.set("mine", "true");
        url.searchParams.set("maxResults", "50");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = channelsResponseSchema.parse(
          await request(url.toString()),
        );
        for (const item of response.items ?? []) {
          channels.push(channelSummary(item));
        }
        pageToken = response.nextPageToken || undefined;
        if (!pageToken) return channels;
      }
      throw new YoutubeApiError(
        0,
        "YouTube channel discovery exceeded 10 pages.",
        "too_many_pages",
      );
    },

    async listVideos(
      videoIds: readonly string[],
    ): Promise<YoutubeVideoSummary[]> {
      if (videoIds.length === 0) return [];
      const videos: YoutubeVideoSummary[] = [];
      for (let index = 0; index < videoIds.length; index += 50) {
        const url = new URL(`${YOUTUBE_DATA_API}/videos`);
        url.searchParams.set("part", "snippet");
        url.searchParams.set("id", videoIds.slice(index, index + 50).join(","));
        url.searchParams.set("maxResults", "50");
        const response = videosResponseSchema.parse(
          await request(url.toString()),
        );
        for (const item of response.items ?? []) {
          videos.push({
            videoId: item.id,
            title: item.snippet.title,
            channelId: item.snippet.channelId,
          });
        }
      }
      return videos;
    },

    async query(query: YoutubeAnalyticsQuery): Promise<YoutubeReportRow[]> {
      const url = new URL(`${YOUTUBE_ANALYTICS_API}/reports`);
      url.searchParams.set("ids", `channel==${query.channelId}`);
      url.searchParams.set("startDate", query.startDate);
      url.searchParams.set("endDate", query.endDate);
      url.searchParams.set("metrics", query.metrics.join(","));
      if (query.dimensions?.length) {
        url.searchParams.set("dimensions", query.dimensions.join(","));
      }
      if (query.filters) url.searchParams.set("filters", query.filters);
      if (query.sort) url.searchParams.set("sort", query.sort);
      if (query.maxResults) {
        url.searchParams.set("maxResults", String(query.maxResults));
      }
      if (query.startIndex) {
        url.searchParams.set("startIndex", String(query.startIndex));
      }
      const body = analyticsResponseSchema.parse(await request(url.toString()));
      return rowsFromAnalytics(body);
    },
  };
}
