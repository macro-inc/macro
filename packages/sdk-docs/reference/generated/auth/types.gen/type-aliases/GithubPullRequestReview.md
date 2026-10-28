# Type Alias: GithubPullRequestReview

> **GithubPullRequestReview** = \{ `reviewerGithubUserId`: `string`; `reviewerLogin?`: `string` \| `null`; `state`: [`GithubPullRequestReviewState`](GithubPullRequestReviewState.md); `submittedAt?`: `string` \| `null`; \}

A reviewer's latest submitted review on a pull request.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-reviewergithubuserid"></a> `reviewerGithubUserId` | `string` | The stable numeric GitHub user id of the reviewer, as a string. |
| <a id="property-reviewerlogin"></a> `reviewerLogin?` | `string` \| `null` | The reviewer's GitHub login, when known. |
| <a id="property-state"></a> `state` | [`GithubPullRequestReviewState`](GithubPullRequestReviewState.md) | What the review said. |
| <a id="property-submittedat"></a> `submittedAt?` | `string` \| `null` | When the review was submitted, when known. |
