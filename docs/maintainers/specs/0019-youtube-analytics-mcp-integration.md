# YouTube Analytics MCP integration

## Status

Accepted for the self-hosted fork. The connection, channel picker, and read-only reports below are the first version.

## Context

OpenSEO can read a project's Search Console property and GA4 property. Those grants say nothing about a YouTube channel the same organization publishes. YouTube Analytics adds watch time, audience actions, traffic sources, and the search terms YouTube itself recorded. The first release answers those questions for one connected channel. It does not offer an open report builder.

Search Console, GA4, and YouTube stay separate sources. Their dates, attribution, and definitions are not interchangeable. YouTube report dates are calendar dates in Pacific Time (`America/Los_Angeles`).

## Decision

Add a native YouTube connection and five read-only, project-scoped MCP tools.

### Authentication and grant ownership

Use a dedicated Google OAuth grant with the provider ID `google-youtube`. The app's own Google OAuth flow issues it, the same flow as Search Console and Analytics. It requests:

- `openid`, `email`, and `profile` identify the connected Google account.
- `https://www.googleapis.com/auth/yt-analytics.readonly` reads reports. This scope is required.
- `https://www.googleapis.com/auth/youtube.readonly` lists channels and reads video titles. This scope is also required when Google returns a scope list. An omitted scope list means Google granted every requested scope.

Do not add these scopes to `google-search-console` or `google-analytics`. A separate grant keeps those connections unchanged, allows a different Google account for the channel, and gives YouTube its own reconnect and disconnect lifecycle. No YouTube write scope is allowed.

The connecting OpenSEO user owns the grant. Tokens stay encrypted in the `account` table under `google-youtube`. Feature tables do not copy them. The partial unique index on Google data grants includes this provider id alongside Search Console and Analytics, so one user can hold all three grants for the same Google account, and a later consent still keeps an existing refresh token.

Hosted and self-hosted OpenSEO reuse the existing Google OAuth client and register `/api/youtube/oauth/callback`. The operator enables the YouTube Analytics API and YouTube Data API v3. YouTube adds no application secret.

### Channel mapping

Channel discovery calls YouTube Data API `channels.list` with `mine=true` and follows `nextPageToken`. Every returned channel is offered, including Brand Account channels. The picker does not assume a single personal channel, and reports do not use `channel==MINE`. A selected channel is stored by its channel id and later queried as `ids=channel==CHANNEL_ID`, which is what addresses a Brand Account channel on that grant.

`managedByMe` and the YouTube partner scope were rejected. Those are for a YouTube content-owner CMS account, not for Brand Accounts, and they need a scope this integration does not request.

The Integrations page and the service share the same checks. Only the UI connects a Google account. Reporting tools accept a `projectId` and read the channel bound to it.

`youtube_connections` belongs to the project and organization. Any current member who can access the project can read through the mapping. The service still calls YouTube with the connector account that selected the channel.

The row stores the channel id, title, custom URL, thumbnail URL, connector user, Google account id, and account email. Clients cannot submit the organization, connector user, email, or channel title. The service copies those from the fresh `channels.list` response after it confirms the channel is on that grant.

Disconnecting deletes the project's mapping. It does not delete the grant, and it does not delete Search Console or Analytics grants. Removing the YouTube Google account deletes YouTube mappings for that account only. A token is revoked only when no stored data grant for that Google account remains.

### Fixed report inputs

Every tool requires `projectId`. Date tools also accept:

| Field       | Contract                                         |
| ----------- | ------------------------------------------------ |
| `startDate` | `YYYY-MM-DD`, supplied together with `endDate`   |
| `endDate`   | `YYYY-MM-DD`, supplied together with `startDate` |

With no dates, the range is the last 28 complete days in Pacific Time. Explicit ranges are inclusive. A single date, a reversed range, or a calendar day that does not exist returns `validation_error` before an API call.

`get_youtube_top_videos`, `get_youtube_traffic_sources`, and `get_youtube_search_terms` also accept `limit` from 1 through 200, default 25. `get_youtube_video_stats` accepts `videoId`, an 11-character YouTube video id.

Callers cannot provide channel ids, arbitrary metrics, dimensions, or YouTube request JSON.

### Fixed reports

Reports call YouTube Analytics API v2 `reports.query`. A missing row is unknown and is not synthesized as zero. A row YouTube returned with zeros stays zero.

| Tool                           | Fixed request                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_youtube_channel_overview` | No dimensions. Metrics: views, estimatedMinutesWatched, averageViewDuration, subscribersGained, subscribersLost, likes, comments, shares. The same query runs for the immediately previous window of equal length. |
| `get_youtube_top_videos`       | Dimension `video`, sorted by views descending, then Data API `videos.list` for titles. Same metrics as the overview.                                                                                               |
| `get_youtube_traffic_sources`  | Dimension `insightTrafficSourceType`. Metrics: views, estimatedMinutesWatched. Subscriber and engagement metrics are not requested here; YouTube rejects them on this dimension.                                   |
| `get_youtube_search_terms`     | Dimension `insightTrafficSourceDetail` with filter `insightTrafficSourceType==YT_SEARCH`. Metrics: views, estimatedMinutesWatched.                                                                                 |
| `get_youtube_video_stats`      | Filter `video==VIDEO_ID`, overview metrics, plus the title when the Data API returns one.                                                                                                                          |

These reports do not consume OpenSEO credits.

### Errors

Each tool returns `status: "ok"` or `status: "error"`. Not connected, a missing scope, a revoked grant, an inaccessible channel, and a disabled YouTube API each have their own error code and a link back to the project's integrations settings. A missing analytics scope or a missing channel connection is reported before an Analytics call. A missing Data API scope is reported before a title lookup.

### Alternatives considered

Adding the YouTube scopes to the Analytics grant would have forced one Google account to serve both products and would have changed the consent screen for people who only use GA4. Querying `channel==MINE` would have ignored a selected Brand Account channel whenever that was not the token's default channel. A dashboard chart was left out of this version; the connection lives on the integrations page and the reports are the MCP tools.
