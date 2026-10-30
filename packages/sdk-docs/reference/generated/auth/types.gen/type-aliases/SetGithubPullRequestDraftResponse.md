# Type Alias: SetGithubPullRequestDraftResponse

> **SetGithubPullRequestDraftResponse** = \{ `draft`: `boolean`; `pullRequest?`: `null` \| [`EnrichedGithubPullRequest`](EnrichedGithubPullRequest.md); \}

Response body for a pull request whose draft state changed.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-draft"></a> `draft` | `boolean` | Whether the pull request is now a draft. |
| <a id="property-pullrequest"></a> `pullRequest?` | `null` \| [`EnrichedGithubPullRequest`](EnrichedGithubPullRequest.md) | - |
