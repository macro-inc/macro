# Type Alias: SessionPullRequestLink

> **SessionPullRequestLink** = \{ `createdAt`: `string`; `githubKey`: `string`; `linkedBy?`: `string` \| `null`; `source`: [`PullRequestLinkSource`](PullRequestLinkSource.md); `url`: `string`; \}

A pull request associated with a session.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When the pull request was associated with the session. |
| <a id="property-githubkey"></a> `githubKey` | `string` | The pull request's `owner/repo/pull/number` key. |
| <a id="property-linkedby"></a> `linkedBy?` | `string` \| `null` | The Macro user who linked it, for links a person made. |
| <a id="property-source"></a> `source` | [`PullRequestLinkSource`](PullRequestLinkSource.md) | Who associated the pull request with the session. |
| <a id="property-url"></a> `url` | `string` | The pull request's GitHub URL. |
