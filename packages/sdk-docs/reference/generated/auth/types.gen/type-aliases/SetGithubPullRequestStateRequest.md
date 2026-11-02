# Type Alias: SetGithubPullRequestStateRequest

> **SetGithubPullRequestStateRequest** = \{ `number`: `number`; `owner`: `string`; `repo`: `string`; `state`: [`GithubPullRequestState`](GithubPullRequestState.md); \}

A request to close one pull request, or reopen it, on the user's behalf.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-number"></a> `number` | `number` | The GitHub pull request number. |
| <a id="property-owner"></a> `owner` | `string` | The GitHub repository owner or organization. |
| <a id="property-repo"></a> `repo` | `string` | The GitHub repository name. |
| <a id="property-state"></a> `state` | [`GithubPullRequestState`](GithubPullRequestState.md) | `closed` closes the pull request; `open` reopens it. |
