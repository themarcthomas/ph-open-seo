# YouTube Analytics MCP integration

## Status

Accepted for the self-hosted fork. Modelled on the Google Analytics connection in spec 0007, with a separate grant so existing Search Console and Analytics consents stay unchanged.

## Context

OpenSEO can read a project's Search Console property and GA4 property. It cannot read the YouTube channel those same operators often publish to. The first release answers a fixed set of read-only questions: how the channel did over a date range, which videos led, where the views came from, which YouTube Search terms sent them, and how one video performed.

## Decision

Add a YouTube connection and five read-only, project-scoped MCP tools.

### Authentication

Use a dedicated Google OAuth grant with the provider ID `youtube` and the callback `/api/youtube/oauth/callback`. Request:

- `openid`, `email`, and `profile` to identify the connected Google account.
- `https://www.googleapis.com/auth/yt-analytics.readonly` (required) to read reports.
- `https://www.googleapis.com/auth/youtube.readonly` to list channels and video titles.

Both YouTube scopes must be granted or the callback stores nothing. Search Console and Analytics keep their own provider IDs, scopes, and callbacks. No YouTube write scope and no monetary scope is requested.

The connecting user owns the grant. Tokens stay in the `account` table, encrypted the same way as the other Google grants. The partial unique index that lets two OpenSEO users connect the same Google account now also covers `youtube`. Existing Search Console and Analytics rows are not rewritten.

A self-hosted operator reuses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `BETTER_AUTH_SECRET`, enables the YouTube Analytics API and YouTube Data API v3, adds the two YouTube scopes on the consent screen, and registers `/api/youtube/oauth/callback`. YouTube adds no application secret.

### Channel mapping

Channel discovery calls YouTube Data API `channels.list` with `mine=true`, `part=snippet`, and `maxResults=50`, and follows `nextPageToken`. Channels that omit statistics or a custom URL are kept. That is what a Brand Account channel looks like when the user selected that Brand Account in Google's account chooser. There is no API that lists every Brand Account a personal login can manage, so a missing channel asks the user to reconnect and pick the Brand Account.

The Integrations page and the dashboard card select a channel through the same service check. Reporting tools take a `projectId` and read the channel bound to it. They do not take a channel id from the caller, except `get_youtube_video_stats`, which takes a video id and checks that the video belongs to the connected channel.

`youtube_connections` has matching SQLite and Postgres definitions: one row per project, the channel id and title, optional custom URL and thumbnail, and the connector user and Google account. Disconnecting deletes that project's row and does not delete the grant while another project still uses it.

### Reports

YouTube Analytics dates are interpreted in `America/Los_Angeles`. With no dates, the range is the last 28 complete days. An end date after yesterday in that zone is clamped, and the response says so. The previous period is the immediately preceding span of the same length.

| Tool                           | Request                                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_youtube_channel_overview` | No dimensions. Metrics `views`, `estimatedMinutesWatched`, `averageViewDuration`, `subscribersGained`, `subscribersLost`, `likes`, `comments`, `shares`. One call for the range and one for the previous period. |
| `get_youtube_top_videos`       | Dimension `video`, those same metrics, sort `-views`. Titles come from Data API `videos.list`. A missing title stays null. Limit 1–50, default 10.                                                               |
| `get_youtube_traffic_sources`  | Dimension `insightTrafficSourceType`. Metrics `views`, `estimatedMinutesWatched`. Sort `-views`. Limit 1–50, default 25.                                                                                         |
| `get_youtube_search_terms`     | Dimension `insightTrafficSourceDetail`, filter `insightTrafficSourceType==YT_SEARCH`, same two metrics. YouTube caps this report at 25 rows.                                                                     |
| `get_youtube_video_stats`      | Filter `video==VIDEO_ID` and the overview metrics. The video must be on the connected channel.                                                                                                                   |

A missing project connection returns `youtube_not_connected`. A grant that lacks either YouTube scope, or a Google 403 for insufficient permission, returns `youtube_scope_missing`. Both include the project Integrations URL. These reports do not use OpenSEO credits.

### Errors

| Code                           | When                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `validation_error`             | Bad dates, limits, or video id. No YouTube call.                    |
| `youtube_not_connected`        | The project has no channel.                                         |
| `youtube_reconnect_required`   | The grant is gone or Google returned 401.                           |
| `youtube_scope_missing`        | Analytics or Data scope was not granted.                            |
| `youtube_channel_inaccessible` | Google returned 403 or 404 for the mapped channel.                  |
| `youtube_api_disabled`         | The YouTube API is not enabled on the OAuth client's Cloud project. |
| `youtube_video_not_found`      | Data API has no such video.                                         |
| `youtube_video_not_in_channel` | The video belongs to a different channel.                           |
| `youtube_quota_exhausted`      | Google returned 429.                                                |
| `youtube_upstream_unavailable` | Google 5xx or a network failure.                                    |
| `youtube_malformed_response`   | A 2xx body failed validation.                                       |

An empty analytics row is unknown, not a synthesized zero. A row YouTube returned as zero stays zero.

## Non-goals

- Uploading, commenting, or changing a channel.
- Revenue and ad metrics (`yt-analytics-monetary.readonly` is not requested).
- Listing every Brand Account a personal Google login can switch into.
- Storing report rows.
- Treating YouTube totals as comparable to GA4 sessions or Search Console clicks.

## References

- [YouTube Analytics API `reports.query`](https://developers.google.com/youtube/analytics/reference/reports/query)
- [YouTube Analytics dimensions](https://developers.google.com/youtube/analytics/dimensions)
- [YouTube Data API `channels.list`](https://developers.google.com/youtube/v3/docs/channels/list)
- [OpenSEO Google Analytics decision](./0007-google-analytics-mcp-integration.md)
