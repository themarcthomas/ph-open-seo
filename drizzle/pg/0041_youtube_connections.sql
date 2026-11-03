CREATE TABLE "youtube_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_title" text NOT NULL,
	"channel_custom_url" text,
	"channel_thumbnail_url" text,
	"connected_by_user_id" text NOT NULL,
	"youtube_account_id" text NOT NULL,
	"connected_account_email" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
DROP INDEX "account_google_grant_owner_idx";--> statement-breakpoint
ALTER TABLE "youtube_connections" ADD CONSTRAINT "youtube_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_connections" ADD CONSTRAINT "youtube_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_connections_project_idx" ON "youtube_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "youtube_connections_organization_idx" ON "youtube_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "youtube_connections_connector_idx" ON "youtube_connections" USING btree ("connected_by_user_id","youtube_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_google_grant_owner_idx" ON "account" USING btree ("user_id","provider_id","account_id") WHERE "account"."provider_id" in ('google-search-console', 'google-analytics', 'google-youtube');