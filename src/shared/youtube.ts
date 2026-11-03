/** Better Auth provider ID for the dedicated YouTube grant. */
export const YOUTUBE_OAUTH_PROVIDER_ID = "google-youtube";

/** Required to read YouTube Analytics reports. */
export const YOUTUBE_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";

/** Required to list the account's channels, including Brand Accounts, and to read video titles. */
export const YOUTUBE_DATA_SCOPE =
  "https://www.googleapis.com/auth/youtube.readonly";

export const YOUTUBE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  YOUTUBE_ANALYTICS_SCOPE,
  YOUTUBE_DATA_SCOPE,
] as const;

/** YouTube Analytics reports dates in this time zone. */
export const YOUTUBE_REPORTING_TIME_ZONE = "America/Los_Angeles";

export const YOUTUBE_SELF_HOSTED_SETUP_DOCS_URL =
  "https://github.com/themarcthomas/ph-open-seo/blob/main/docs/SELF_HOSTING_YOUTUBE.md";
