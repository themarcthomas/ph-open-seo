import { AppError } from "@/server/lib/errors";
import { createYoutubeClient } from "@/server/lib/youtubeClient";
import { YoutubeApiError, YoutubeTokenError } from "@/server/lib/youtubeErrors";
import { getGoogleAccessMode } from "@/server/features/google/googleAccess";
import {
  GATEWAY_GOOGLE_ACCOUNT_ID,
  getGatewayGoogleStatus,
} from "@/server/features/google/gatewayGoogle";
import { grantOmitsScope } from "@/server/features/youtube/youtubeGrantScope";
import {
  YoutubeConnectionRepository,
  type YoutubeConnection,
  type YoutubeGrant,
} from "@/server/features/youtube/repositories/YoutubeConnectionRepository";
import { YOUTUBE_ANALYTICS_SCOPE, YOUTUBE_DATA_SCOPE } from "@/shared/youtube";

async function listGrants(userId: string): Promise<YoutubeGrant[]> {
  if ((await getGoogleAccessMode()) === "gateway") {
    return (await getGatewayGoogleStatus()).connected
      ? [{ accountId: GATEWAY_GOOGLE_ACCOUNT_ID, scope: null }]
      : [];
  }
  return YoutubeConnectionRepository.listGrants(userId);
}

function needsReconnect(error: unknown): boolean {
  return (
    error instanceof YoutubeTokenError ||
    (error instanceof YoutubeApiError &&
      (error.status === 401 ||
        error.reason === "insufficientPermissions" ||
        error.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
  );
}

async function listChannelsForUser(userId: string) {
  const grants = await listGrants(userId);
  const accounts = await Promise.all(
    grants.map(async (grant) => {
      const scopeMissing =
        grantOmitsScope(grant.scope, YOUTUBE_ANALYTICS_SCOPE) ||
        grantOmitsScope(grant.scope, YOUTUBE_DATA_SCOPE);
      if (scopeMissing) {
        return {
          accountId: grant.accountId,
          email: null,
          requiresReconnect: true,
          propertiesUnavailable: false,
          apiDisabled: false,
          channels: [],
        };
      }
      const client = createYoutubeClient({
        userId,
        youtubeAccountId: grant.accountId,
      });
      try {
        const channels = await client.listChannels();
        let email: string | null = null;
        try {
          email = await client.getUserInfoEmail();
        } catch {
          email = null;
        }
        return {
          accountId: grant.accountId,
          email,
          requiresReconnect: false,
          propertiesUnavailable: false,
          apiDisabled: false,
          channels,
        };
      } catch (error) {
        const reconnect = needsReconnect(error);
        if (!reconnect) {
          console.error("youtube.channel_discovery_failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            status: error instanceof YoutubeApiError ? error.status : undefined,
            reason: error instanceof YoutubeApiError ? error.reason : undefined,
          });
        }
        return {
          accountId: grant.accountId,
          email: null,
          requiresReconnect: reconnect,
          propertiesUnavailable: !reconnect,
          apiDisabled:
            error instanceof YoutubeApiError &&
            error.reason === "accessNotConfigured",
          channels: [],
        };
      }
    }),
  );
  return { accounts };
}

async function setChannel(input: {
  projectId: string;
  organizationId: string;
  channelId: string;
  accountId: string;
  userId: string;
}): Promise<YoutubeConnection> {
  const grants = await listGrants(input.userId);
  const grant = grants.find((item) => item.accountId === input.accountId);
  if (!grant) {
    throw new AppError(
      "NOT_FOUND",
      "That Google account isn't connected to your OpenSEO account.",
    );
  }
  if (
    grantOmitsScope(grant.scope, YOUTUBE_DATA_SCOPE) ||
    grantOmitsScope(grant.scope, YOUTUBE_ANALYTICS_SCOPE)
  ) {
    throw new AppError(
      "NOT_FOUND",
      "Reconnect YouTube and approve YouTube Analytics and YouTube read-only access.",
    );
  }
  const client = createYoutubeClient({
    userId: input.userId,
    youtubeAccountId: input.accountId,
  });
  const channels = await client.listChannels();
  const channel = channels.find((item) => item.channelId === input.channelId);
  if (!channel) {
    throw new AppError(
      "NOT_FOUND",
      "That YouTube channel isn't available on your connected Google account.",
    );
  }
  let connectedAccountEmail: string | null = null;
  try {
    connectedAccountEmail = await client.getUserInfoEmail();
  } catch {
    connectedAccountEmail = null;
  }
  return YoutubeConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    channelId: channel.channelId,
    channelTitle: channel.title,
    channelCustomUrl: channel.customUrl,
    channelThumbnailUrl: channel.thumbnailUrl,
    connectedByUserId: input.userId,
    youtubeAccountId: input.accountId,
    connectedAccountEmail,
  });
}

async function disconnect(input: { projectId: string }): Promise<void> {
  await YoutubeConnectionRepository.deleteByProjectId(input.projectId);
}

async function userHasGrant(userId: string): Promise<boolean> {
  const grants = await listGrants(userId);
  return grants.length > 0;
}

export const YoutubeService = {
  getConnection: YoutubeConnectionRepository.getByProjectId,
  userHasGrant,
  listChannelsForUser,
  setChannel,
  disconnect,
};
