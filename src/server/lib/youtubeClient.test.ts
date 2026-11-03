import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createYoutubeClient } from "./youtubeClient";
import { YoutubeApiError } from "./youtubeErrors";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("@/server/features/google/googleOAuth", () => ({
  getGoogleAccessToken: mocks.getAccessToken,
}));

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

describe("youtubeClient", () => {
  beforeEach(() => {
    mocks.getAccessToken.mockResolvedValue("yt_tok");
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps every channel from mine=true, including a Brand Account channel", async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UCpersonalchannel00000001",
              snippet: { title: "Personal", customUrl: "@personal" },
            },
          ],
          nextPageToken: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UCbrandaccountchannel0001",
              snippet: {
                title: "Brand channel",
                thumbnails: {
                  medium: { url: "https://i.ytimg.com/brand.jpg" },
                },
              },
            },
          ],
        }),
      );

    const channels = await createYoutubeClient({
      userId: "u1",
      youtubeAccountId: "sub-a",
    }).listChannels();

    expect(channels).toEqual([
      {
        channelId: "UCpersonalchannel00000001",
        title: "Personal",
        customUrl: "@personal",
        thumbnailUrl: null,
      },
      {
        channelId: "UCbrandaccountchannel0001",
        title: "Brand channel",
        customUrl: null,
        thumbnailUrl: "https://i.ytimg.com/brand.jpg",
      },
    ]);
    expect(requestUrl(mocks.fetch.mock.calls[0][0])).toContain("mine=true");
    expect(requestUrl(mocks.fetch.mock.calls[1][0])).toContain(
      "pageToken=page-2",
    );
    expect(mocks.getAccessToken).toHaveBeenCalledWith({
      providerId: "google-youtube",
      userId: "u1",
      accountId: "sub-a",
    });
  });

  it("reads report columns by name", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse({
        columnHeaders: [
          { name: "views", dataType: "INTEGER" },
          { name: "estimatedMinutesWatched", dataType: "FLOAT" },
        ],
        rows: [[12, "3.5"]],
      }),
    );

    await expect(
      createYoutubeClient({
        userId: "u1",
        youtubeAccountId: "sub-a",
      }).queryReport({
        channelId: "UCbrandaccountchannel0001",
        startDate: "2026-04-01",
        endDate: "2026-04-07",
        metrics: ["views", "estimatedMinutesWatched"],
        dimensions: ["insightTrafficSourceType"],
      }),
    ).resolves.toEqual([{ views: 12, estimatedMinutesWatched: 3.5 }]);

    const url = new URL(requestUrl(mocks.fetch.mock.calls[0][0]));
    expect(url.searchParams.get("ids")).toBe(
      "channel==UCbrandaccountchannel0001",
    );
    expect(url.searchParams.get("dimensions")).toBe("insightTrafficSourceType");
  });

  it("surfaces a missing scope from a YouTube 403", async () => {
    mocks.fetch.mockResolvedValue(
      jsonResponse(
        { error: { errors: [{ reason: "insufficientPermissions" }] } },
        403,
      ),
    );

    await expect(
      createYoutubeClient({
        userId: "u1",
        youtubeAccountId: "sub-a",
      }).listChannels(),
    ).rejects.toMatchObject({
      name: "YoutubeApiError",
      status: 403,
      reason: "insufficientPermissions",
    } satisfies Partial<YoutubeApiError>);
  });
});
