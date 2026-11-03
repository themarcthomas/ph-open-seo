import { sortBy } from "remeda";

/** A video is worth promoting when people who start it watch much longer than the channel's other videos, but few people see it. */
const HIGH_RETENTION_MULTIPLE = 1.5;
const HIGH_RETENTION_MIN_SECONDS = 60;
const HIGH_RETENTION_MIN_VIEWS = 10;
const HIGH_RETENTION_MIN_VIDEOS = 4;

/** A loss needs a real previous audience and a clear drop, so a handful of views does not count. */
const LOSING_MIN_PREVIOUS_VIEWS = 50;
const LOSING_MIN_DROP_RATIO = 0.25;
const LOSING_MIN_ABSOLUTE_DROP = 20;

const SEARCH_TERM_MIN_VIEWS = 10;

/** Other sites account for a large share of the video, not a handful of referral clicks. */
const EXTERNAL_MIN_VIEWS = 50;
const EXTERNAL_MIN_SHARE = 0.3;

const MAX_PER_KIND = 5;

const INTENT =
  /\b(how to|how do|tutorial|walkthrough|demo|guide|explained|review|comparison|versus|vs\.?|what is)\b/i;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "and",
  "in",
  "on",
  "with",
  "how",
  "your",
  "my",
  "is",
  "do",
  "i",
  "you",
  "it",
  "from",
  "this",
  "that",
]);

export type OpportunityVideo = {
  videoId: string;
  title: string | null;
  views: number | null;
  averageViewDuration: number | null;
  previousViews: number | null;
};

type OpportunityTerm = {
  term: string;
  views: number | null;
  estimatedMinutesWatched: number | null;
};

export type OpportunityQuery = {
  query: string;
  impressions: number;
  clicks: number;
};

export type ExternalVideo = {
  videoId: string;
  title: string | null;
  externalViews: number;
  totalViews: number;
};

export type EmbeddingPage = {
  url: string;
  views: number;
};

type YoutubeOpportunityKind =
  | "promote_high_retention"
  | "losing_views"
  | "youtube_search_gap"
  | "search_console_video_idea"
  | "external_embeds";

type YoutubeOpportunity = {
  kind: YoutubeOpportunityKind;
  headline: string;
  evidence: Array<{ label: string; value: number }>;
};

function median(values: number[]): number {
  const sorted = sortBy(values, (value) => value);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function sharedPrefixLength(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (index < length && left[index] === right[index]) index += 1;
  return index;
}

/** "prune" and "pruning" share a stem; short words do not match a longer word by accident. */
function stemsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 4) return false;
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  return longer.startsWith(shorter) || sharedPrefixLength(left, right) >= 4;
}

function titleMatchesTerm(title: string, term: string): boolean {
  const normalizedTitle = tokens(title).join(" ");
  const normalizedTerm = tokens(term).join(" ");
  if (!normalizedTerm) return false;
  if (normalizedTitle.includes(normalizedTerm)) return true;
  const termTokens = tokens(term).filter(
    (token) => token.length >= 3 && !STOP_WORDS.has(token),
  );
  if (termTokens.length === 0) return false;
  const titleTokens = tokens(title);
  return termTokens.every((token) =>
    titleTokens.some((titleToken) => stemsMatch(token, titleToken)),
  );
}

function videoName(video: { title: string | null; videoId: string }): string {
  return video.title?.trim() || video.videoId;
}

function hasMatchingVideo(term: string, videos: OpportunityVideo[]): boolean {
  return videos.some(
    (video) => video.title !== null && titleMatchesTerm(video.title, term),
  );
}

function promoteHighRetention(
  videos: OpportunityVideo[],
): YoutubeOpportunity[] {
  const comparable = videos.filter(
    (
      video,
    ): video is OpportunityVideo & {
      views: number;
      averageViewDuration: number;
    } => video.views !== null && video.averageViewDuration !== null,
  );
  if (comparable.length < HIGH_RETENTION_MIN_VIDEOS) return [];
  const medianViews = median(comparable.map((video) => video.views));
  const medianDuration = median(
    comparable.map((video) => video.averageViewDuration),
  );
  const durationFloor = Math.max(
    HIGH_RETENTION_MIN_SECONDS,
    medianDuration * HIGH_RETENTION_MULTIPLE,
  );
  return sortBy(
    comparable.filter(
      (video) =>
        video.averageViewDuration >= durationFloor &&
        video.views >= HIGH_RETENTION_MIN_VIEWS &&
        video.views <= medianViews,
    ),
    [(video) => video.averageViewDuration, "desc"],
  )
    .slice(0, MAX_PER_KIND)
    .map((video) => ({
      kind: "promote_high_retention" as const,
      headline: `Promote “${videoName(video)}”. People who start it keep watching, and it has few views.`,
      evidence: [
        {
          label: "Average view duration (seconds)",
          value: Math.round(video.averageViewDuration),
        },
        { label: "Views", value: video.views },
        { label: "Median views", value: Math.round(medianViews) },
      ],
    }));
}

function losingViews(videos: OpportunityVideo[]): YoutubeOpportunity[] {
  return sortBy(
    videos.flatMap((video) => {
      if (video.views === null || video.previousViews === null) return [];
      const drop = video.previousViews - video.views;
      if (video.previousViews < LOSING_MIN_PREVIOUS_VIEWS) return [];
      if (drop < LOSING_MIN_ABSOLUTE_DROP) return [];
      if (drop / video.previousViews < LOSING_MIN_DROP_RATIO) return [];
      return [{ video, drop }];
    }),
    [(row) => row.drop, "desc"],
  )
    .slice(0, MAX_PER_KIND)
    .map(({ video, drop }) => ({
      kind: "losing_views" as const,
      headline: `“${videoName(video)}” lost views compared with the previous period.`,
      evidence: [
        { label: "Views", value: video.views ?? 0 },
        { label: "Previous views", value: video.previousViews ?? 0 },
        { label: "Views lost", value: drop },
      ],
    }));
}

function youtubeSearchGaps(
  terms: OpportunityTerm[],
  videos: OpportunityVideo[],
): YoutubeOpportunity[] {
  return sortBy(
    terms.filter(
      (term): term is OpportunityTerm & { views: number } =>
        term.term.trim().length > 0 &&
        term.views !== null &&
        term.views >= SEARCH_TERM_MIN_VIEWS &&
        !hasMatchingVideo(term.term, videos),
    ),
    [(term) => term.views, "desc"],
  )
    .slice(0, MAX_PER_KIND)
    .map((term) => ({
      kind: "youtube_search_gap" as const,
      headline: `Make a video for the YouTube search “${term.term}”. No video title closely matches it.`,
      evidence: [
        { label: "Views", value: term.views },
        {
          label: "Watch time (minutes)",
          value: Math.round(term.estimatedMinutesWatched ?? 0),
        },
      ],
    }));
}

function searchConsoleIdeas(
  queries: OpportunityQuery[] | null,
  videos: OpportunityVideo[],
): YoutubeOpportunity[] {
  if (!queries) return [];
  return sortBy(
    queries.filter(
      (query) =>
        query.impressions > 0 &&
        INTENT.test(query.query) &&
        !hasMatchingVideo(query.query, videos),
    ),
    [(query) => query.impressions, "desc"],
  )
    .slice(0, MAX_PER_KIND)
    .map((query) => ({
      kind: "search_console_video_idea" as const,
      headline: `Google shows “${query.query}” and no video title closely matches it.`,
      evidence: [
        { label: "Impressions", value: query.impressions },
        { label: "Clicks", value: query.clicks },
      ],
    }));
}

function externalEmbeds(
  videos: ExternalVideo[] | null,
  pages: EmbeddingPage[] | null,
): YoutubeOpportunity[] {
  if (!videos || !pages) return [];
  const heavy = videos.filter(
    (video) =>
      video.totalViews > 0 &&
      video.externalViews >= EXTERNAL_MIN_VIEWS &&
      video.externalViews / video.totalViews >= EXTERNAL_MIN_SHARE,
  );
  const embeds = pages.filter((page) => page.url.trim() && page.views > 0);
  if (heavy.length === 0 || embeds.length === 0) return [];
  return [
    {
      kind: "external_embeds",
      headline:
        "These videos get a large share of their views from other sites. These pages embed the channel.",
      evidence: [
        ...heavy.slice(0, MAX_PER_KIND).flatMap((video) => [
          {
            label: `External views for ${videoName(video)}`,
            value: video.externalViews,
          },
          {
            label: `Views for ${videoName(video)}`,
            value: video.totalViews,
          },
        ]),
        ...embeds.slice(0, MAX_PER_KIND).map((page) => ({
          label: `Embed views on ${page.url}`,
          value: page.views,
        })),
      ],
    },
  ];
}

export function buildYoutubeOpportunities(input: {
  videos: OpportunityVideo[];
  searchTerms: OpportunityTerm[];
  searchConsoleQueries: OpportunityQuery[] | null;
  externalVideos: ExternalVideo[] | null;
  embeddingPages: EmbeddingPage[] | null;
}): YoutubeOpportunity[] {
  return [
    ...promoteHighRetention(input.videos),
    ...losingViews(input.videos),
    ...youtubeSearchGaps(input.searchTerms, input.videos),
    ...searchConsoleIdeas(input.searchConsoleQueries, input.videos),
    ...externalEmbeds(input.externalVideos, input.embeddingPages),
  ];
}
