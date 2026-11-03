import { describe, expect, it } from "vitest";
import {
  buildYoutubeOpportunities,
  type OpportunityVideo,
} from "./youtubeOpportunities";

function video(overrides: Partial<OpportunityVideo> = {}): OpportunityVideo {
  return {
    videoId: "aaaaaaaaaaa",
    title: "Garden tour",
    views: 400,
    averageViewDuration: 40,
    previousViews: null,
    ...overrides,
  };
}

const comparable = [
  video({
    videoId: "aaaaaaaaaaa",
    title: "Garden tour",
    views: 400,
    averageViewDuration: 30,
  }),
  video({
    videoId: "bbbbbbbbbbb",
    title: "Spring beds",
    views: 500,
    averageViewDuration: 40,
  }),
  video({
    videoId: "ccccccccccc",
    title: "Tool shed",
    views: 600,
    averageViewDuration: 50,
  }),
];

describe("YouTube opportunity rules", () => {
  it("promotes a video people finish when almost nobody sees it", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [
        ...comparable,
        video({
          videoId: "ddddddddddd",
          title: "Pruning roses",
          views: 20,
          averageViewDuration: 180,
        }),
      ],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(opportunities).toEqual([
      expect.objectContaining({
        kind: "promote_high_retention",
        evidence: [
          { label: "Average view duration (seconds)", value: 180 },
          { label: "Views", value: 20 },
          { label: "Median views", value: 450 },
        ],
      }),
    ]);
  });

  it("leaves a long video alone when it already has the views", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [
        ...comparable,
        video({
          videoId: "ddddddddddd",
          title: "Pruning roses",
          views: 700,
          averageViewDuration: 180,
        }),
      ],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(
      opportunities.some((item) => item.kind === "promote_high_retention"),
    ).toBe(false);
  });

  it("does not call a short, quiet video high retention", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [
        ...comparable,
        video({
          videoId: "ddddddddddd",
          title: "Quick clip",
          views: 20,
          averageViewDuration: 40,
        }),
      ],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(
      opportunities.some((item) => item.kind === "promote_high_retention"),
    ).toBe(false);
  });

  it("needs enough videos to tell high retention from the rest", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [
        video({ views: 20, averageViewDuration: 180 }),
        video({ videoId: "bbbbbbbbbbb", views: 500, averageViewDuration: 30 }),
      ],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(opportunities).toEqual([]);
  });

  it("flags a video that lost a clear share of its views", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [
        video({
          title: "Spring beds",
          views: 70,
          previousViews: 100,
        }),
      ],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(opportunities).toEqual([
      expect.objectContaining({
        kind: "losing_views",
        evidence: [
          { label: "Views", value: 70 },
          { label: "Previous views", value: 100 },
          { label: "Views lost", value: 30 },
        ],
      }),
    ]);
  });

  it("ignores a small dip and a video that gained views", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [
        video({ title: "Small dip", views: 80, previousViews: 100 }),
        video({
          videoId: "bbbbbbbbbbb",
          title: "Growing",
          views: 140,
          previousViews: 100,
        }),
        video({
          videoId: "ccccccccccc",
          title: "Tiny channel",
          views: 10,
          previousViews: 40,
        }),
      ],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(opportunities).toEqual([]);
  });

  it("asks for a video when a YouTube search has views and no close title", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [video({ title: "Garden tour" })],
      searchTerms: [
        {
          term: "how to prune roses",
          views: 40,
          estimatedMinutesWatched: 18.4,
        },
        { term: "garden tour", views: 90, estimatedMinutesWatched: 30 },
        { term: "rare query", views: 9, estimatedMinutesWatched: 2 },
      ],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(opportunities.map((item) => item.kind)).toEqual([
      "youtube_search_gap",
    ]);
    expect(opportunities[0]?.headline).toContain("how to prune roses");
    expect(opportunities[0]?.evidence).toEqual([
      { label: "Views", value: 40 },
      { label: "Watch time (minutes)", value: 18 },
    ]);
  });

  it("treats a stemmed title as a match for a YouTube search", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [video({ title: "Pruning roses in spring" })],
      searchTerms: [
        { term: "how to prune roses", views: 40, estimatedMinutesWatched: 18 },
      ],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(opportunities).toEqual([]);
  });

  it("turns a Search Console query with impressions into a video idea", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [video({ title: "Garden tour" })],
      searchTerms: [],
      searchConsoleQueries: [
        { query: "rose pruning tutorial", impressions: 80, clicks: 4 },
        { query: "pricing", impressions: 500, clicks: 20 },
        { query: "demo", impressions: 0, clicks: 0 },
      ],
      externalVideos: null,
      embeddingPages: null,
    });

    expect(opportunities).toEqual([
      expect.objectContaining({
        kind: "search_console_video_idea",
        evidence: [
          { label: "Impressions", value: 80 },
          { label: "Clicks", value: 4 },
        ],
      }),
    ]);
  });

  it("skips Search Console ideas when Search Console is not connected", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: null,
      embeddingPages: null,
    });

    expect(
      opportunities.some((item) => item.kind === "search_console_video_idea"),
    ).toBe(false);
  });

  it("notes embedding pages for videos that live on other sites", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: [
        {
          videoId: "aaaaaaaaaaa",
          title: "Garden tour",
          externalViews: 80,
          totalViews: 100,
        },
        {
          videoId: "bbbbbbbbbbb",
          title: "Spring beds",
          externalViews: 10,
          totalViews: 200,
        },
      ],
      embeddingPages: [{ url: "https://example.com/roses", views: 55 }],
    });

    expect(opportunities).toEqual([
      expect.objectContaining({
        kind: "external_embeds",
        evidence: [
          { label: "External views for Garden tour", value: 80 },
          { label: "Views for Garden tour", value: 100 },
          { label: "Embed views on https://example.com/roses", value: 55 },
        ],
      }),
    ]);
  });

  it("skips external-traffic ideas when YouTube does not return embedding pages", () => {
    const opportunities = buildYoutubeOpportunities({
      videos: [],
      searchTerms: [],
      searchConsoleQueries: null,
      externalVideos: [
        {
          videoId: "aaaaaaaaaaa",
          title: "Garden tour",
          externalViews: 80,
          totalViews: 100,
        },
      ],
      embeddingPages: null,
    });

    expect(opportunities).toEqual([]);
  });
});
