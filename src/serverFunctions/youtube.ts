import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { YoutubeReportingService } from "@/server/features/youtube/services/YoutubeReportingService";
import { YoutubeService } from "@/server/features/youtube/services/YoutubeService";
import { getGoogleAccessMode } from "@/server/features/google/googleAccess";
import { getGatewayGoogleConnectUrl } from "@/server/features/google/gatewayGoogle";
import {
  createGoogleAuthorizationUrl,
  YOUTUBE_INTEGRATION,
} from "@/server/features/google/googleOAuth";
import { hasGoogleOAuthConfig } from "@/server/features/google/oauth-config";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { AppError } from "@/server/lib/errors";
import { YoutubeReportError } from "@/server/lib/youtubeErrors";
import { captureServerEvent } from "@/server/lib/posthog";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const setChannelSchema = projectScopedSchema.extend({
  accountId: z.string().min(1),
  channelId: z.string().regex(/^UC[\w-]{22}$/),
});
const startLinkSchema = z.object({
  callbackURL: z.string().min(1),
});

export const getYoutubeConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [connection, currentUserHasGrant, googleOAuthConfigured] =
      await Promise.all([
        YoutubeService.getConnection(context.projectId),
        YoutubeService.userHasGrant(context.userId),
        hasGoogleOAuthConfig(),
      ]);
    return {
      connected: Boolean(connection),
      canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
      currentUserHasGrant,
      googleOAuthConfigured,
      channelId: connection?.channelId ?? null,
      channelTitle: connection?.channelTitle ?? null,
      channelCustomUrl: connection?.channelCustomUrl ?? null,
      connectedByEmail: connection?.connectedAccountEmail ?? null,
      connectedAt: connection?.createdAt ?? null,
    };
  });

export const getYoutubeDashboardReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    try {
      const overview = await YoutubeReportingService.getChannelOverview({
        projectId: context.projectId,
      });
      return {
        connected: true as const,
        channelTitle: overview.source.channelTitle,
        range: overview.request.resolvedDateRange,
        current: overview.current,
        previous: overview.previous,
      };
    } catch (error) {
      if (
        error instanceof YoutubeReportError &&
        (error.code === "youtube_not_connected" ||
          error.code === "youtube_reconnect_required" ||
          error.code === "youtube_scope_missing" ||
          error.code === "youtube_channel_inaccessible")
      ) {
        return { connected: false as const };
      }
      if (
        error instanceof YoutubeReportError &&
        error.code === "youtube_quota_exhausted"
      ) {
        throw new AppError("RATE_LIMITED");
      }
      throw error;
    }
  });

export const listYoutubeChannels = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [channelList, connection] = await Promise.all([
      YoutubeService.listChannelsForUserWithGrantStatus(context.userId),
      YoutubeService.getConnection(context.projectId),
    ]);
    return {
      accounts: channelList.accounts.map((grant) => ({
        ...grant,
        channels: grant.channels.map((channel) => ({
          ...channel,
          isSelected:
            connection?.youtubeAccountId === grant.accountId &&
            connection.channelId === channel.channelId,
        })),
      })),
    };
  });

export const setYoutubeChannel = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setChannelSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    const connection = await YoutubeService.setChannel({
      projectId: context.projectId,
      organizationId: context.organizationId,
      accountId: data.accountId,
      channelId: data.channelId,
      userId: context.userId,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "youtube:channel_select",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId },
      }),
    );
    return {
      connected: true as const,
      channelId: connection.channelId,
      channelTitle: connection.channelTitle,
      channelCustomUrl: connection.channelCustomUrl,
      connectedByEmail: connection.connectedAccountEmail,
      connectedAt: connection.createdAt,
    };
  });

export const disconnectYoutube = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    await YoutubeService.disconnect({ projectId: context.projectId });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "youtube:disconnect",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId },
      }),
    );
    return { connected: false as const };
  });

export const startYoutubeLink = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(startLinkSchema)
  .handler(async ({ data, context }) => ({
    url:
      (await getGoogleAccessMode()) === "gateway"
        ? await getGatewayGoogleConnectUrl(data.callbackURL)
        : await createGoogleAuthorizationUrl({
            integration: YOUTUBE_INTEGRATION,
            userId: context.userId,
            callbackURL: data.callbackURL,
            publicOrigin: getPublicOrigin(getRequest()),
          }),
  }));
