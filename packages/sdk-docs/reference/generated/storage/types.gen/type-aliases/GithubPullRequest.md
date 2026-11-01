# Type Alias: GithubPullRequest

> **GithubPullRequest** = \{ `additions?`: `number` \| `null`; `checks?`: [`GithubPullRequestCheckRun`](GithubPullRequestCheckRun.md)[] \| `null`; `comments?`: [`GithubPullRequestComment`](GithubPullRequestComment.md)[] \| `null`; `deletions?`: `number` \| `null`; `displayName`: `string`; `foreignEntityId?`: `string` \| `null`; `githubKey`: `string`; `name?`: `string` \| `null`; `number`: `number`; `owner`: `string`; `repo`: `string`; `status?`: `string` \| `null`; `url`: `string`; \}

Display-ready data for a GitHub pull request associated with a task.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-additions"></a> `additions?` | `number` \| `null` | The number of added lines in the pull request, when enrichment data is available. |
| <a id="property-checks"></a> `checks?` | [`GithubPullRequestCheckRun`](GithubPullRequestCheckRun.md)[] \| `null` | Check runs collected from the pull request head commit, when enrichment data is available. |
| <a id="property-comments"></a> `comments?` | [`GithubPullRequestComment`](GithubPullRequestComment.md)[] \| `null` | Comments collected from the pull request, when enrichment data is available. |
| <a id="property-deletions"></a> `deletions?` | `number` \| `null` | The number of deleted lines in the pull request, when enrichment data is available. |
| <a id="property-displayname"></a> `displayName` | `string` | A compact label suitable for display in the UI. |
| <a id="property-foreignentityid"></a> `foreignEntityId?` | `string` \| `null` | The internal `foreign_entity.id` UUID for the GitHub pull request row. |
| <a id="property-githubkey"></a> `githubKey` | `string` | The stored GitHub association key, in `owner/repo/pull/number` format. |
| <a id="property-name"></a> `name?` | `string` \| `null` | The GitHub pull request title, when enrichment data is available. |
| <a id="property-number"></a> `number` | `number` | The GitHub pull request number. |
| <a id="property-owner"></a> `owner` | `string` | The GitHub repository owner or organization. |
| <a id="property-repo"></a> `repo` | `string` | The GitHub repository name. |
| <a id="property-status"></a> `status?` | `string` \| `null` | The GitHub pull request status, when enrichment data is available. |
| <a id="property-url"></a> `url` | `string` | The public GitHub URL for the pull request. |
