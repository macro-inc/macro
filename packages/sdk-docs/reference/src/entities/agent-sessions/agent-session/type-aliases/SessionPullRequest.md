# Type Alias: SessionPullRequest

> **SessionPullRequest** = \{ `createdAt`: `string`; `githubKey`: `string`; `linkedBy?`: [`User`](../../../users/user/classes/User.md); `source`: [`PullRequestLinkSource`](../../../../../generated/agent-harness/types.gen/type-aliases/PullRequestLinkSource.md); `url`: `string`; \}

A GitHub pull request linked to a session.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When it was linked. |
| <a id="property-githubkey"></a> `githubKey` | `string` | The pull request's `owner/repo/pull/number` key. |
| <a id="property-linkedby"></a> `linkedBy?` | [`User`](../../../users/user/classes/User.md) | Who linked it, for pull requests a person linked. |
| <a id="property-source"></a> `source` | [`PullRequestLinkSource`](../../../../../generated/agent-harness/types.gen/type-aliases/PullRequestLinkSource.md) | Whether the session's agent opened it or a person linked it. |
| <a id="property-url"></a> `url` | `string` | The pull request's GitHub URL. |
