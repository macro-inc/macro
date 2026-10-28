# Type Alias: EnrichedGithubPullRequest

> **EnrichedGithubPullRequest** = \{ `additions?`: `number` \| `null`; `assignees?`: [`GithubPullRequestUser`](GithubPullRequestUser.md)[] \| `null`; `authorId?`: `number` \| `null`; `authorLogin?`: `string` \| `null`; `checks?`: [`GithubPullRequestCheckRun`](GithubPullRequestCheckRun.md)[] \| `null`; `comments?`: [`GithubPullRequestComment`](GithubPullRequestComment.md)[] \| `null`; `deletions?`: `number` \| `null`; `description?`: `string` \| `null`; `displayName`: `string`; `githubKey`: `string`; `labels?`: [`GithubPullRequestLabel`](GithubPullRequestLabel.md)[] \| `null`; `name?`: `string` \| `null`; `number`: `number`; `owner`: `string`; `participantGithubUserIds?`: `string`[] \| `null`; `repo`: `string`; `reviews?`: [`GithubPullRequestReview`](GithubPullRequestReview.md)[] \| `null`; `status?`: `null` \| [`GithubPullRequestStatus`](GithubPullRequestStatus.md); `url`: `string`; \}

A pull request reference enriched with live GitHub details when available.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-additions"></a> `additions?` | `number` \| `null` | The number of added lines reported by GitHub, when enrichment succeeds. |
| <a id="property-assignees"></a> `assignees?` | [`GithubPullRequestUser`](GithubPullRequestUser.md)[] \| `null` | The users assigned to the pull request, when known. |
| <a id="property-authorid"></a> `authorId?` | `number` \| `null` | The stable numeric GitHub user id for the pull request author, when available. |
| <a id="property-authorlogin"></a> `authorLogin?` | `string` \| `null` | The GitHub login for the pull request author, when available. |
| <a id="property-checks"></a> `checks?` | [`GithubPullRequestCheckRun`](GithubPullRequestCheckRun.md)[] \| `null` | Check runs collected from the pull request head commit, when enrichment includes them. |
| <a id="property-comments"></a> `comments?` | [`GithubPullRequestComment`](GithubPullRequestComment.md)[] \| `null` | Comments collected from the pull request, when enrichment includes them. |
| <a id="property-deletions"></a> `deletions?` | `number` \| `null` | The number of deleted lines reported by GitHub, when enrichment succeeds. |
| <a id="property-description"></a> `description?` | `string` \| `null` | The pull request description (body), when available. |
| <a id="property-displayname"></a> `displayName` | `string` | A compact label suitable for display in the UI. |
| <a id="property-githubkey"></a> `githubKey` | `string` | The stored GitHub association key, in `owner/repo/pull/number` format. |
| <a id="property-labels"></a> `labels?` | [`GithubPullRequestLabel`](GithubPullRequestLabel.md)[] \| `null` | The pull request's labels, when known. |
| <a id="property-name"></a> `name?` | `string` \| `null` | The GitHub pull request title, when enrichment succeeds. |
| <a id="property-number"></a> `number` | `number` | The GitHub pull request number. |
| <a id="property-owner"></a> `owner` | `string` | The GitHub repository owner or organization. |
| <a id="property-participantgithubuserids"></a> `participantGithubUserIds?` | `string`[] \| `null` | Stable numeric GitHub user ids (as strings) for everyone involved in the pull request. Queried by the foreign entity `includes_me` filter, so stored metadata merges this as a union rather than replacing it (partial write paths must not drop known participants). |
| <a id="property-repo"></a> `repo` | `string` | The GitHub repository name. |
| <a id="property-reviews"></a> `reviews?` | [`GithubPullRequestReview`](GithubPullRequestReview.md)[] \| `null` | Each reviewer's latest submitted review, when known. Stored metadata merges this per reviewer, so a write that knows one review keeps the others. |
| <a id="property-status"></a> `status?` | `null` \| [`GithubPullRequestStatus`](GithubPullRequestStatus.md) | - |
| <a id="property-url"></a> `url` | `string` | The public GitHub URL for the pull request. |
