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

/** Presets on the YouTube report. The same set as Search Performance. */
export const YOUTUBE_REPORT_RANGES = [
  "last_7_days",
  "last_28_days",
  "last_3_months",
] as const;

export type YoutubeReportRange = (typeof YOUTUBE_REPORT_RANGES)[number];

/** YouTube Analytics `insightTrafficSourceType` values, named the way Studio does. */
const YOUTUBE_TRAFFIC_SOURCE_LABELS: Record<string, string> = {
  ADVERTISING: "YouTube ads",
  ANNOTATION: "Annotations",
  CAMPAIGN_CARD: "Campaign cards",
  END_SCREEN: "End screens",
  EXT_URL: "External sites",
  HASHTAGS: "Hashtags",
  IMMERSIVE_LIVE: "Live",
  LIVE_REDIRECT: "Live redirects",
  NO_LINK_EMBEDDED: "Embedded players",
  NO_LINK_OTHER: "Direct or unknown",
  NOTIFICATION: "Notifications",
  PLAYLIST: "Playlists",
  PRODUCT_PAGE: "Product pages",
  PROMOTED: "YouTube promotions",
  RELATED_VIDEO: "Suggested videos",
  SHORTS: "Shorts feed",
  SHORTS_CONTENT_LINKS: "Shorts links",
  SOUND_PAGE: "Sound pages",
  SUBSCRIBER: "Browse features",
  VIDEO_REMIXES: "Remixes",
  YT_CHANNEL: "Channel pages",
  YT_OTHER_PAGE: "Other YouTube pages",
  YT_PLAYLIST_PAGE: "Playlist pages",
  YT_SEARCH: "YouTube search",
};

export function youtubeTrafficSourceLabel(code: string): string {
  return (
    YOUTUBE_TRAFFIC_SOURCE_LABELS[code] ??
    code
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^\w/, (letter) => letter.toUpperCase())
  );
}

export const YOUTUBE_SELF_HOSTED_SETUP_DOCS_URL =
  "https://github.com/themarcthomas/ph-open-seo/blob/main/docs/SELF_HOSTING_YOUTUBE.md";
