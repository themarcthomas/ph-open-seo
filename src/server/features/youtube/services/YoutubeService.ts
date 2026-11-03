import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { getGoogleAccessMode } from "@/server/features/google/googleAccess";
import {
  GATEWAY_GOOGLE_ACCOUNT_ID,
  getGatewayGoogleStatus,
} from "@/server/features/google/gatewayGoogle";
import {
  YoutubeConnectionRepository,
  type YoutubeConnection,
} from "@/server/features/youtube/repositories/YoutubeConnectionRepository";
import { createYoutubeClient } from "@/server/lib/youtubeClient";
import { YoutubeApiError, YoutubeTokenError } from "@/server/lib/youtubeErrors";
import { AppError } from "@/server/lib/errors";
import {
  YOUTUBE_OAUTH_PROVIDER_ID,
  youtubeGrantIsMissingScope,
} from "@/shared/youtube";

type YoutubeGrant = { id: string; accountId: string; scope: string | null };

async function getConnection(
  projectId: string,
): Promise<YoutubeConnection | null> {
  return YoutubeConnectionRepository.getByProjectId(projectId);
}

async function listGrantsForUser(userId: string): Promise<YoutubeGrant[]> {
  if ((await getGoogleAccessMode()) === "gateway") {
    return (await getGatewayGoogleStatus()).connected
      ? [
          {
            id: GATEWAY_GOOGLE_ACCOUNT_ID,
            accountId: GATEWAY_GOOGLE_ACCOUNT_ID,
            scope: null,
          },
        ]
      : [];
  }
  return db
    .select({
      id: account.id,
      accountId: account.accountId,
      scope: account.scope,
    })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, YOUTUBE_OAUTH_PROVIDER_ID),
      ),
    );
}

async function userHasGrant(userId: string): Promise<boolean> {
  const grants = await listGrantsForUser(userId);
  return grants.length > 0;
}

function requiresReconnect(error: unknown): boolean {
  return (
    error instanceof YoutubeTokenError ||
    (error instanceof YoutubeApiError && error.status === 401)
  );
}

async function listChannelsForUserWithGrantStatus(userId: string) {
  const grants = await listGrantsForUser(userId);
  const accounts = await Promise.all(
    grants.map(async (grant) => {
      const scopeMissing = youtubeGrantIsMissingScope(grant.scope);
      if (scopeMissing) {
        return {
          accountId: grant.accountId,
          email: null as string | null,
          requiresReconnect: false,
          scopeMissing: true,
          channelsUnavailable: false,
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
          scopeMissing: false,
          channelsUnavailable: false,
          channels,
        };
      } catch (error) {
        const reconnect = requiresReconnect(error);
        if (!reconnect) {
          console.error("youtube.channel_discovery_failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            status: error instanceof YoutubeApiError ? error.status : undefined,
          });
        }
        return {
          accountId: grant.accountId,
          email: null,
          requiresReconnect: reconnect,
          scopeMissing:
            error instanceof YoutubeApiError && isScopeReason(error.reason),
          channelsUnavailable: !reconnect,
          channels: [],
        };
      }
    }),
  );
  return { accounts };
}

function isScopeReason(reason: string | null): boolean {
  return (
    reason === "insufficientPermissions" ||
    reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
    reason === "insufficient_scope"
  );
}

async function setChannel(input: {
  projectId: string;
  organizationId: string;
  channelId: string;
  accountId: string;
  userId: string;
}): Promise<YoutubeConnection> {
  const grants = await listGrantsForUser(input.userId);
  const grant = grants.find((item) => item.accountId === input.accountId);
  if (!grant) {
    throw new AppError(
      "NOT_FOUND",
      "That Google account isn't connected to your OpenSEO account.",
    );
  }
  if (youtubeGrantIsMissingScope(grant.scope)) {
    throw new AppError(
      "FORBIDDEN",
      "Reconnect YouTube and approve both the YouTube Analytics and YouTube read-only permissions.",
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
      "That YouTube channel isn't available on your connected Google account. Brand Account channels appear when you choose that Brand Account in Google's account chooser.",
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

export const YoutubeService = {
  getConnection,
  userHasGrant,
  listChannelsForUserWithGrantStatus,
  setChannel,
  disconnect,
};
