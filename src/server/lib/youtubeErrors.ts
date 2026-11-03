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
  | "youtube_video_not_found"
  | "youtube_video_not_in_channel"
  | "youtube_quota_exhausted"
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
