export class YoutubeApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly reason: string | null = null,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "YoutubeApiError";
  }
}

export class YoutubeTokenError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "YoutubeTokenError";
  }
}

export class YoutubeMalformedResponseError extends Error {
  constructor() {
    super("YouTube returned an invalid response.");
    this.name = "YoutubeMalformedResponseError";
  }
}

type YoutubeReportErrorCode =
  | "validation_error"
  | "youtube_not_connected"
  | "youtube_reconnect_required"
  | "youtube_scope_missing"
  | "youtube_channel_inaccessible"
  | "youtube_api_disabled"
  | "youtube_quota_exhausted"
  | "youtube_query_rejected"
  | "youtube_upstream_unavailable"
  | "youtube_malformed_response";

export class YoutubeReportError extends Error {
  constructor(
    public readonly code: YoutubeReportErrorCode,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "YoutubeReportError";
  }
}

const SCOPE_REASONS = new Set([
  "insufficientPermissions",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "insufficientAuthenticationScopes",
]);

const QUOTA_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

export function youtubeReportErrorFromApi(
  error: YoutubeApiError,
): YoutubeReportError {
  const reason = error.reason;
  if (error.status === 401 || reason === "authError") {
    return new YoutubeReportError(
      "youtube_reconnect_required",
      "The YouTube connection has expired or was revoked. Reconnect YouTube in project settings.",
    );
  }
  if (reason && SCOPE_REASONS.has(reason)) {
    return new YoutubeReportError(
      "youtube_scope_missing",
      "The YouTube connection is missing a required permission. Reconnect and approve YouTube Analytics and YouTube read-only access.",
    );
  }
  if (reason === "accessNotConfigured") {
    return new YoutubeReportError(
      "youtube_api_disabled",
      "YouTube Analytics API or YouTube Data API v3 is not enabled for this Google Cloud project.",
    );
  }
  if (error.status === 429 || (reason && QUOTA_REASONS.has(reason))) {
    return new YoutubeReportError(
      "youtube_quota_exhausted",
      "YouTube's API quota is exhausted. Try again later.",
      error.retryAfterSeconds,
    );
  }
  if (error.status === 400) {
    return new YoutubeReportError(
      "youtube_query_rejected",
      "YouTube rejected the report query.",
    );
  }
  if (error.status === 403 || error.status === 404) {
    return new YoutubeReportError(
      "youtube_channel_inaccessible",
      "YouTube denied access to this channel. Reconnect a Google account that manages it.",
    );
  }
  return new YoutubeReportError(
    "youtube_upstream_unavailable",
    "YouTube reporting is temporarily unavailable.",
    error.retryAfterSeconds,
  );
}
