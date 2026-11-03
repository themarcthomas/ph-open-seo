import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { account, youtubeConnections } from "@/db/schema";
import { YOUTUBE_OAUTH_PROVIDER_ID } from "@/shared/youtube";

export type YoutubeConnection = typeof youtubeConnections.$inferSelect;

export type YoutubeGrant = {
  accountId: string;
  scope: string | null;
};

async function getByProjectId(
  projectId: string,
): Promise<YoutubeConnection | null> {
  const rows = await db
    .select()
    .from(youtubeConnections)
    .where(eq(youtubeConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function listGrants(userId: string): Promise<YoutubeGrant[]> {
  return db
    .select({ accountId: account.accountId, scope: account.scope })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, YOUTUBE_OAUTH_PROVIDER_ID),
      ),
    );
}

async function getGrant(
  userId: string,
  accountId: string,
): Promise<YoutubeGrant | null> {
  const rows = await db
    .select({ accountId: account.accountId, scope: account.scope })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, YOUTUBE_OAUTH_PROVIDER_ID),
        eq(account.accountId, accountId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function upsert(input: {
  projectId: string;
  organizationId: string;
  channelId: string;
  channelTitle: string;
  channelCustomUrl: string | null;
  channelThumbnailUrl: string | null;
  connectedByUserId: string;
  youtubeAccountId: string;
  connectedAccountEmail: string | null;
}): Promise<YoutubeConnection> {
  const [row] = await db
    .insert(youtubeConnections)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoUpdate({
      target: youtubeConnections.projectId,
      set: {
        organizationId: input.organizationId,
        channelId: input.channelId,
        channelTitle: input.channelTitle,
        channelCustomUrl: input.channelCustomUrl,
        channelThumbnailUrl: input.channelThumbnailUrl,
        connectedByUserId: input.connectedByUserId,
        youtubeAccountId: input.youtubeAccountId,
        connectedAccountEmail: sql`case
          when ${youtubeConnections.connectedByUserId} = ${input.connectedByUserId}
            and ${youtubeConnections.youtubeAccountId} = ${input.youtubeAccountId}
          then coalesce(${input.connectedAccountEmail}, ${youtubeConnections.connectedAccountEmail})
          else ${input.connectedAccountEmail}
        end`,
        updatedAt: sql`(current_timestamp)`,
      },
    })
    .returning();
  if (!row) throw new Error("Failed to upsert youtube_connection");
  return row;
}

async function deleteByProjectId(projectId: string): Promise<void> {
  await db
    .delete(youtubeConnections)
    .where(eq(youtubeConnections.projectId, projectId));
}

export const YoutubeConnectionRepository = {
  getByProjectId,
  listGrants,
  getGrant,
  upsert,
  deleteByProjectId,
};
