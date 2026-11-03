# Self-hosted YouTube Analytics

Connecting YouTube lets a project read one channel's analytics. The connection is optional and read-only. It uses its own Google consent, separate from Search Console and Google Analytics.

## What you'll need

- A Google account that owns the channel, or the Brand Account that owns it.
- A Google Cloud project with OAuth credentials.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BETTER_AUTH_SECRET` set on the OpenSEO deployment.

If Search Console or Google Analytics is already connected, reuse the same Google Cloud project and OAuth client. YouTube still asks for a separate consent grant.

## 1) Enable the YouTube APIs

In the [Google Cloud Console](https://console.cloud.google.com/), enable both:

- [YouTube Analytics API](https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com)
- [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)

The Data API lists channels and video titles. The Analytics API powers the reports.

## 2) Add the YouTube scopes

Under **APIs & Services → OAuth consent screen**, add these scopes:

- `https://www.googleapis.com/auth/yt-analytics.readonly`
- `https://www.googleapis.com/auth/youtube.readonly`
- `openid`, `email`, and `profile` (already present if you configured Search Console)

`yt-analytics.readonly` is required. `youtube.readonly` is required to choose a channel and to show video titles. Do not add a YouTube write scope.

While the app is in Testing, add every Google account that will connect as a test user. Publish the app when you are ready: Google expires refresh tokens for External apps in Testing after 7 days. See the [Search Console guide](./SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md#2-configure-the-oauth-consent-screen).

## 3) Register the callback URL

Open **APIs & Services → Credentials**, edit the Web application OAuth client, and add an authorized redirect URI matching the deployment origin plus `/api/youtube/oauth/callback`.

| Deployment   | Redirect URI                                                 |
| ------------ | ------------------------------------------------------------ |
| Deployed     | `https://your-openseo-domain.com/api/youtube/oauth/callback` |
| Local Docker | `http://localhost:3001/api/youtube/oauth/callback`           |

Keep the existing `/api/gsc/oauth/callback` and `/api/ga4/oauth/callback` URIs if those integrations use the same client.

## 4) Connect a channel

Open **Project settings → Integrations**, click **Connect with Google** on the YouTube card, and approve both YouTube permissions.

If the channel belongs to a Brand Account, choose that Brand Account in Google's account chooser. `channels.list?mine=true` returns the channel for the account you select, including a Brand Account channel.

Disconnecting YouTube does not disconnect Search Console or Google Analytics.

## Troubleshooting

**`redirect_uri_mismatch`** — the registered URI must match the scheme, host, port, and `/api/youtube/oauth/callback` path used by the deployment.

**No channels appear** — confirm the YouTube Data API is enabled. If you manage a Brand Account, reconnect and select that Brand Account instead of your personal Google account.

**Reports fail after connect** — confirm the YouTube Analytics API is enabled and the consent screen includes `yt-analytics.readonly`.
