import { beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubeApiError } from "@/server/lib/youtubeErrors";
import { createYoutubeClient } from "@/server/lib/youtubeClient";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/google/googleAccess", () => ({
  getGoogleAccessMode: async () => "own_client",
}));
vi.mock("@/server/features/google/googleOAuth", () => ({
  getGoogleAccessToken: async () => "token",
}));

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("YouTube client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("pages channels.list mine=true and keeps a Brand Account channel without statistics", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UCpersonal0000000000000000",
              snippet: { title: "Personal" },
              statistics: { subscriberCount: "10" },
            },
          ],
          nextPageToken: "page-2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "UCbrandaccount0000000000",
              snippet: { title: "Brand" },
            },
          ],
        }),
      );

    const channels = await createYoutubeClient({
      userId: "user-1",
      youtubeAccountId: "google-1",
    }).listChannels();

    const first = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const second = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(first.searchParams.get("mine")).toBe("true");
    expect(first.searchParams.get("maxResults")).toBe("50");
    expect(second.searchParams.get("pageToken")).toBe("page-2");
    expect(channels.map((channel) => channel.title)).toEqual([
      "Personal",
      "Brand",
    ]);
    expect(channels[1]).toMatchObject({
      channelId: "UCbrandaccount0000000000",
      customUrl: null,
      thumbnailUrl: null,
    });
  });

  it("reports a missing YouTube scope from a 403", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              code: 403,
              message: "Insufficient Permission",
              errors: [{ reason: "insufficientPermissions" }],
            },
          },
          403,
        ),
      ),
    );

    const client = createYoutubeClient({
      userId: "user-1",
      youtubeAccountId: "google-1",
    });
    await expect(client.listChannels()).rejects.toMatchObject({
      name: "YoutubeApiError",
      status: 403,
      reason: "insufficientPermissions",
    });
    await expect(client.listChannels()).rejects.toBeInstanceOf(YoutubeApiError);
  });
});
