import { beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubeApiError, YoutubeTokenError } from "@/server/lib/youtubeErrors";
import { YoutubeService } from "./YoutubeService";

const mocks = vi.hoisted(() => {
  const listChannels = vi.fn();
  const getUserInfoEmail = vi.fn();
  return {
    listChannels,
    getUserInfoEmail,
    createYoutubeClient: vi.fn(() => ({ listChannels, getUserInfoEmail })),
    listGrants: vi.fn(),
    upsert: vi.fn(),
  };
});

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/youtubeClient", () => ({
  createYoutubeClient: mocks.createYoutubeClient,
}));
vi.mock(
  "@/server/features/youtube/repositories/YoutubeConnectionRepository",
  () => ({
    YoutubeConnectionRepository: {
      listGrants: mocks.listGrants,
      upsert: mocks.upsert,
      getByProjectId: vi.fn(),
      deleteByProjectId: vi.fn(),
      getGrant: vi.fn(),
    },
  }),
);

const brandChannel = {
  channelId: "UCbrandaccountchannel0001",
  title: "Brand channel",
  customUrl: null,
  thumbnailUrl: "https://i.ytimg.com/brand.jpg",
};

describe("YoutubeService", () => {
  beforeEach(() => {
    mocks.listGrants.mockResolvedValue([{ accountId: "sub-a", scope: null }]);
    mocks.listChannels.mockResolvedValue([
      {
        channelId: "UCpersonalchannel00000001",
        title: "Personal",
        customUrl: "@personal",
        thumbnailUrl: null,
      },
      brandChannel,
    ]);
    mocks.getUserInfoEmail.mockResolvedValue("owner@example.com");
    mocks.upsert.mockResolvedValue({ channelId: brandChannel.channelId });
  });

  it("saves a Brand Account channel returned by channels.list mine=true", async () => {
    await YoutubeService.setChannel({
      projectId: "p1",
      organizationId: "org1",
      channelId: brandChannel.channelId,
      accountId: "sub-a",
      userId: "u1",
    });

    expect(mocks.upsert).toHaveBeenCalledWith({
      projectId: "p1",
      organizationId: "org1",
      channelId: brandChannel.channelId,
      channelTitle: "Brand channel",
      channelCustomUrl: null,
      channelThumbnailUrl: "https://i.ytimg.com/brand.jpg",
      connectedByUserId: "u1",
      youtubeAccountId: "sub-a",
      connectedAccountEmail: "owner@example.com",
    });
  });

  it("rejects a channel or connector the current user does not have", async () => {
    await expect(
      YoutubeService.setChannel({
        projectId: "p1",
        organizationId: "org1",
        channelId: brandChannel.channelId,
        accountId: "foreign",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    mocks.listChannels.mockResolvedValue([]);
    await expect(
      YoutubeService.setChannel({
        projectId: "p1",
        organizationId: "org1",
        channelId: brandChannel.channelId,
        accountId: "sub-a",
        userId: "u1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("asks for a reconnect when the grant is missing a YouTube scope", async () => {
    mocks.listGrants.mockResolvedValue([
      {
        accountId: "sub-a",
        scope:
          "openid,email,https://www.googleapis.com/auth/yt-analytics.readonly",
      },
    ]);

    await expect(YoutubeService.listChannelsForUser("u1")).resolves.toEqual({
      accounts: [
        {
          accountId: "sub-a",
          email: null,
          requiresReconnect: true,
          propertiesUnavailable: false,
          apiDisabled: false,
          channels: [],
        },
      ],
    });
    expect(mocks.createYoutubeClient).not.toHaveBeenCalled();
  });

  it("distinguishes an expired grant from a failed channel lookup", async () => {
    mocks.listGrants.mockResolvedValue([
      { accountId: "sub-a", scope: null },
      { accountId: "sub-b", scope: null },
    ]);
    mocks.listChannels
      .mockRejectedValueOnce(new YoutubeTokenError("revoked"))
      .mockRejectedValueOnce(
        new YoutubeApiError(403, "forbidden", "forbidden"),
      );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(YoutubeService.listChannelsForUser("u1")).resolves.toEqual({
      accounts: [
        {
          accountId: "sub-a",
          email: null,
          requiresReconnect: true,
          propertiesUnavailable: false,
          apiDisabled: false,
          channels: [],
        },
        {
          accountId: "sub-b",
          email: null,
          requiresReconnect: false,
          propertiesUnavailable: true,
          apiDisabled: false,
          channels: [],
        },
      ],
    });
  });
});
