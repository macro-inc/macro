# Type Alias: MergeGithubPullRequestResponse

> **MergeGithubPullRequestResponse** = \{ `message`: `string`; `pullRequest?`: `null` \| [`EnrichedGithubPullRequest`](EnrichedGithubPullRequest.md); `sha`: `string`; \}

Response body for a merged pull request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-message"></a> `message` | `string` | GitHub's own summary of the merge. |
| <a id="property-pullrequest"></a> `pullRequest?` | `null` \| [`EnrichedGithubPullRequest`](EnrichedGithubPullRequest.md) | - |
| <a id="property-sha"></a> `sha` | `string` | The merge commit's SHA. |
