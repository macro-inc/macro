# Type Alias: StoredGithubPullRequest

> **StoredGithubPullRequest** = \{ `additions?`: `number` \| `null`; `assignees`: [`GithubPullRequestUser`](GithubPullRequestUser.md)[]; `authorGithubUserId?`: `string` \| `null`; `authorLogin?`: `string` \| `null`; `base?`: `null` \| [`GitRefDto`](GitRefDto.md); `checks`: [`GithubPullRequestCheckRun`](GithubPullRequestCheckRun.md)[]; `comments`: [`GithubPullRequestComment`](GithubPullRequestComment.md)[]; `deletions?`: `number` \| `null`; `description?`: `string` \| `null`; `draft`: `boolean`; `githubKey`: `string`; `githubUpdatedAt?`: `string` \| `null`; `head?`: `null` \| [`GitRefDto`](GitRefDto.md); `id`: `string`; `labels`: [`GithubPullRequestLabel`](GithubPullRequestLabel.md)[]; `number`: `number`; `owner`: `string`; `repo`: `string`; `requestedReviewerGithubUserIds`: `string`[]; `reviewDecision?`: `null` \| [`GithubPullRequestReviewDecision`](GithubPullRequestReviewDecision.md); `reviews`: [`GithubPullRequestReview`](GithubPullRequestReview.md)[]; `status?`: `null` \| `"open"` \| `"closed"` \| `"merged"`; `title?`: `string` \| `null`; `url`: `string`; \}

A GitHub pull request as Macro stores it, read through one of the caller's records.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-additions"></a> `additions?` | `number` \| `null` | Lines added across the pull request's changes. |
| <a id="property-assignees"></a> `assignees` | [`GithubPullRequestUser`](GithubPullRequestUser.md)[] | The users assigned to the pull request. |
| <a id="property-authorgithubuserid"></a> `authorGithubUserId?` | `string` \| `null` | Stable numeric GitHub user id of the author. |
| <a id="property-authorlogin"></a> `authorLogin?` | `string` \| `null` | The author's GitHub login when the pull request was last synced. |
| <a id="property-base"></a> `base?` | `null` \| [`GitRefDto`](GitRefDto.md) | - |
| <a id="property-checks"></a> `checks` | [`GithubPullRequestCheckRun`](GithubPullRequestCheckRun.md)[] | The latest check runs on the pull request's head commit. |
| <a id="property-comments"></a> `comments` | [`GithubPullRequestComment`](GithubPullRequestComment.md)[] | Comments from the pull request's conversation, reviews, and review threads. Comment `authorId` intentionally retains the shared numeric GitHub comment contract; convert it to a decimal string before comparing it with `authorGithubUserId`. |
| <a id="property-deletions"></a> `deletions?` | `number` \| `null` | Lines deleted across the pull request's changes. |
| <a id="property-description"></a> `description?` | `string` \| `null` | The pull request body, as GitHub markdown. |
| <a id="property-draft"></a> `draft` | `boolean` | Whether the pull request is a draft. |
| <a id="property-githubkey"></a> `githubKey` | `string` | The pull request's `owner/repo/pull/number` key. |
| <a id="property-githubupdatedat"></a> `githubUpdatedAt?` | `string` \| `null` | When GitHub last updated the pull request. |
| <a id="property-head"></a> `head?` | `null` \| [`GitRefDto`](GitRefDto.md) | - |
| <a id="property-id"></a> `id` | `string` | The caller's record for the pull request. |
| <a id="property-labels"></a> `labels` | [`GithubPullRequestLabel`](GithubPullRequestLabel.md)[] | The pull request's labels. |
| <a id="property-number"></a> `number` | `number` | The pull request number within its repository. |
| <a id="property-owner"></a> `owner` | `string` | The repository owner the pull request was last synced under. |
| <a id="property-repo"></a> `repo` | `string` | The repository name the pull request was last synced under. |
| <a id="property-requestedreviewergithubuserids"></a> `requestedReviewerGithubUserIds` | `string`[] | Stable numeric GitHub user ids of the users asked to review. |
| <a id="property-reviewdecision"></a> `reviewDecision?` | `null` \| [`GithubPullRequestReviewDecision`](GithubPullRequestReviewDecision.md) | - |
| <a id="property-reviews"></a> `reviews` | [`GithubPullRequestReview`](GithubPullRequestReview.md)[] | Each reviewer's latest submitted review. |
| <a id="property-status"></a> `status?` | `null` \| `"open"` \| `"closed"` \| `"merged"` | The normalized pull request status. |
| <a id="property-title"></a> `title?` | `string` \| `null` | The pull request title. |
| <a id="property-url"></a> `url` | `string` | The pull request's page on GitHub. |
