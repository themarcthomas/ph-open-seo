import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as OAuthModule from "./googleOAuth";

const mocks = vi.hoisted(() => ({
  getGoogleOAuthClientConfig: vi.fn(),
  hasGoogleOAuthConfig: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
  getAuth: vi.fn(),
  getGoogleAccountId: vi.fn(),
  resolveUserContextFromHeaders: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("./googleIdToken", () => ({
  getGoogleAccountId: mocks.getGoogleAccountId,
}));
vi.mock("@/middleware/ensure-user/resolve", () => ({
  resolveUserContextFromHeaders: mocks.resolveUserContextFromHeaders,
}));
vi.mock("@/server/features/google/oauth-config", () => ({
  getGoogleOAuthClientConfig: mocks.getGoogleOAuthClientConfig,
  hasGoogleOAuthConfig: mocks.hasGoogleOAuthConfig,
}));

let client: Client;
let oauth: typeof OAuthModule;
const directory = mkdtempSync(join(tmpdir(), "youtube-oauth-"));
const publicOrigin = "http://localhost:3001";
const callbackURL = `${publicOrigin}/p/project/settings?tab=integrations`;

beforeAll(async () => {
  client = createClient({ url: `file:${join(directory, "test.db")}` });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));
  await client.executeMultiple(
    "CREATE TABLE user (id text PRIMARY KEY); INSERT INTO user VALUES ('user-1');",
  );
  const auth = readFileSync("drizzle/sqlite/0003_light_sage.sql", "utf8")
    .split("--> statement-breakpoint")
    .filter(
      (sql) =>
        sql.includes("CREATE TABLE `account`") ||
        sql.includes("CREATE TABLE `verification`"),
    )
    .join("\n");
  await client.executeMultiple(auth);
  await client.executeMultiple(`
    DROP INDEX IF EXISTS account_google_grant_owner_idx;
    CREATE UNIQUE INDEX account_google_grant_owner_idx
      ON account (user_id, provider_id, account_id)
      WHERE "account"."provider_id" in ('google-search-console', 'google-analytics', 'google-youtube');
  `);
  oauth = await import("./googleOAuth");
});

afterAll(() => {
  client.close();
  rmSync(directory, { recursive: true });
});

beforeEach(async () => {
  await client.execute("DELETE FROM account; DELETE FROM verification;");
  mocks.getGoogleOAuthClientConfig.mockResolvedValue({
    clientId: "google-client-id",
    clientSecret: "google-client-secret",
  });
  mocks.hasGoogleOAuthConfig.mockResolvedValue(true);
  mocks.getGoogleAccountId.mockResolvedValue("google-account-1");
  mocks.getAuth.mockReturnValue({
    $context: Promise.resolve({
      options: { account: { encryptOAuthTokens: false } },
      secretConfig: "secret",
    }),
  });
  mocks.resolveUserContextFromHeaders.mockResolvedValue({ userId: "user-1" });
  vi.stubGlobal("fetch", mocks.fetch);
});

async function connect(scope: string) {
  const url = new URL(
    await oauth.createGoogleAuthorizationUrl({
      integration: oauth.YOUTUBE_INTEGRATION,
      userId: "user-1",
      callbackURL,
      publicOrigin,
    }),
  );
  mocks.fetch.mockResolvedValue(
    Response.json({
      access_token: "yt-access",
      refresh_token: "yt-refresh",
      id_token: "google-id-token",
      scope,
    }),
  );
  const callback = new URL(
    oauth.YOUTUBE_INTEGRATION.callbackPath,
    publicOrigin,
  );
  callback.searchParams.set("state", url.searchParams.get("state")!);
  callback.searchParams.set("code", "yt-code");
  return oauth.handleGoogleOAuthCallbackRequest(
    new Request(callback),
    oauth.YOUTUBE_INTEGRATION,
  );
}

describe("YouTube OAuth grant", () => {
  it("asks for both YouTube scopes on its own callback", async () => {
    const url = new URL(
      await oauth.createGoogleAuthorizationUrl({
        integration: oauth.YOUTUBE_INTEGRATION,
        userId: "user-1",
        callbackURL,
        publicOrigin,
      }),
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${publicOrigin}/api/youtube/oauth/callback`,
    );
    const parts = (url.searchParams.get("scope") ?? "").split(" ");
    expect(parts).toContain(
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    );
    expect(parts).toContain("https://www.googleapis.com/auth/youtube.readonly");
    expect(parts).not.toContain(
      "https://www.googleapis.com/auth/analytics.readonly",
    );
    expect(parts).not.toContain(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
  });

  it("rejects a grant that skipped the Data API scope and keeps Analytics", async () => {
    await client.execute(
      "INSERT INTO account (id, account_id, provider_id, user_id, access_token, refresh_token, created_at, updated_at) VALUES ('ga4', 'google-account-1', 'google-analytics', 'user-1', 'access', 'refresh', 1, 1)",
    );
    const response = await connect(
      "openid https://www.googleapis.com/auth/yt-analytics.readonly",
    );
    expect(response.headers.get("Location")).toBe(
      "/p/project/settings?tab=integrations&google_link_error=youtube&error=scope_not_granted",
    );
    const grants = await client.execute("SELECT provider_id FROM account");
    expect(grants.rows.map((row) => row.provider_id)).toEqual([
      "google-analytics",
    ]);
  });

  it("stores a YouTube grant beside an Analytics grant for the same Google account", async () => {
    await client.execute(
      "INSERT INTO account (id, account_id, provider_id, user_id, access_token, refresh_token, created_at, updated_at) VALUES ('ga4', 'google-account-1', 'google-analytics', 'user-1', 'access', 'refresh', 1, 1)",
    );
    const response = await connect(
      "openid email profile https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly",
    );
    expect(response.status).toBe(303);
    const grants = await client.execute(
      "SELECT provider_id FROM account ORDER BY provider_id",
    );
    expect(grants.rows.map((row) => row.provider_id)).toEqual([
      "google-analytics",
      "google-youtube",
    ]);
  });
});
