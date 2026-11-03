import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// Selected YouTube channel per project. OAuth credentials stay in Better Auth's
// account table under the dedicated "google-youtube" provider.
export const youtubeConnections = sqliteTable(
  "youtube_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    channelTitle: text("channel_title").notNull(),
    channelCustomUrl: text("channel_custom_url"),
    channelThumbnailUrl: text("channel_thumbnail_url"),
    connectedByUserId: text("connected_by_user_id").notNull(),
    youtubeAccountId: text("youtube_account_id").notNull(),
    connectedAccountEmail: text("connected_account_email"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("youtube_connections_project_idx").on(table.projectId),
    index("youtube_connections_organization_idx").on(table.organizationId),
    index("youtube_connections_connector_idx").on(
      table.connectedByUserId,
      table.youtubeAccountId,
    ),
  ],
);
