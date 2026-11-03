/** Better Auth provider ID for the dedicated YouTube grant. */
export const YOUTUBE_OAUTH_PROVIDER_ID = "youtube";

/** Required to read YouTube Analytics reports. */
export const YOUTUBE_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";

/** Required to list the user's channels and resolve video titles. */
export const YOUTUBE_DATA_SCOPE =
  "https://www.googleapis.com/auth/youtube.readonly";

export const YOUTUBE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  YOUTUBE_ANALYTICS_SCOPE,
  YOUTUBE_DATA_SCOPE,
] as const;

export const YOUTUBE_REPORTING_TIME_ZONE = "America/Los_Angeles";

export const YOUTUBE_SELF_HOSTED_SETUP_DOCS_URL =
  "https://github.com/themarcthomas/ph-open-seo/blob/main/docs/SELF_HOSTING_YOUTUBE.md";

/** Stored grants use commas; Google's token response uses spaces. An omitted
 *  scope means the consent screen granted everything that was requested. */
export function youtubeGrantIsMissingScope(scope: string | null): boolean {
  if (!scope) return false;
  const granted = new Set(scope.split(/[,\s]+/).filter(Boolean));
  return (
    !granted.has(YOUTUBE_ANALYTICS_SCOPE) || !granted.has(YOUTUBE_DATA_SCOPE)
  );
}
