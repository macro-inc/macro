# Type Alias: SetGithubPullRequestStateResponse

> **SetGithubPullRequestStateResponse** = \{ `pullRequest?`: `null` \| [`EnrichedGithubPullRequest`](EnrichedGithubPullRequest.md); `state`: [`GithubPullRequestState`](GithubPullRequestState.md); \}

Response body for a pull request that was closed or reopened.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-pullrequest"></a> `pullRequest?` | `null` \| [`EnrichedGithubPullRequest`](EnrichedGithubPullRequest.md) | - |
| <a id="property-state"></a> `state` | [`GithubPullRequestState`](GithubPullRequestState.md) | Whether the pull request is now open or closed. |
