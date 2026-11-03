# Self-hosted YouTube Analytics

Connecting YouTube lets a project read one channel's analytics. The connection is optional and read-only. It does not change an existing Search Console or Google Analytics grant.

## What you'll need

- A Google account that can manage the YouTube channel, including a Brand Account channel.
- The same Google Cloud OAuth client OpenSEO already uses for Search Console or Analytics.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BETTER_AUTH_SECRET` set on the deployment.

YouTube does not add an application secret.

## 1) Enable the YouTube APIs

In the [Google Cloud Console](https://console.cloud.google.com/), enable both:

- [YouTube Analytics API](https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com)
- [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)

Analytics supplies the reports. The Data API lists the channels you can manage and loads video titles.

## 2) Add the scopes

On the OAuth consent screen, add:

- `openid`, `email`, and `profile`
- `https://www.googleapis.com/auth/yt-analytics.readonly`
- `https://www.googleapis.com/auth/youtube.readonly`

Both YouTube scopes have to be granted. YouTube Analytics is what the reports call. YouTube read-only is what lists channels, including Brand Account channels, and reads video titles. Leave the Search Console and Analytics scopes as they are. YouTube uses its own consent grant, so a different Google account can be used for the channel.

While the app is in Testing, add every Google account that will connect as a test user. Publish the app when you can: Google expires refresh tokens for External apps in Testing after 7 days.

## 3) Add the redirect URI

Edit the Web application OAuth client and add an authorized redirect URI for the deployment origin plus `/api/youtube/oauth/callback`.

| Deployment   | Redirect URI                                                 |
| ------------ | ------------------------------------------------------------ |
| Deployed     | `https://your-openseo-domain.com/api/youtube/oauth/callback` |
| Local Docker | `http://localhost:3001/api/youtube/oauth/callback`           |

Keep the existing `/api/gsc/oauth/callback` and `/api/ga4/oauth/callback` URIs if those products use the same client.

## 4) Connect a channel

Open **Project settings → Integrations**, choose **YouTube Analytics**, and approve both YouTube permissions. Pick the channel. Brand Account channels are listed with the personal channel when Google returns them for that account. Disconnecting the project removes only that channel selection.

## Troubleshooting

**`redirect_uri_mismatch`** — the registered URI has to match the scheme, host, port, and `/api/youtube/oauth/callback` path exactly.

**The connect button says YouTube is not configured** — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `BETTER_AUTH_SECRET` is missing.

**Reports say a scope is missing** — reconnect and leave both YouTube boxes checked. Enabling the APIs in Google Cloud is also required before the first successful call.
