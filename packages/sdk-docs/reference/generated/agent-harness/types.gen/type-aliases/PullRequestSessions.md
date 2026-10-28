# Type Alias: PullRequestSessions

> **PullRequestSessions** = \{ `githubKey`: `string`; `sessions`: [`PullRequestLinkedSession`](PullRequestLinkedSession.md)[]; `url`: `string`; \}

The sessions linked to one pull request that the caller can view.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-githubkey"></a> `githubKey` | `string` | The pull request's `owner/repo/pull/number` key. |
| <a id="property-sessions"></a> `sessions` | [`PullRequestLinkedSession`](PullRequestLinkedSession.md)[] | Linked sessions the caller can view, oldest link first. |
| <a id="property-url"></a> `url` | `string` | The requested pull request URL, canonicalized. |
