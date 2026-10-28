# Type Alias: GithubPrReview

> **GithubPrReview** = [`GithubPrNotificationCommon`](GithubPrNotificationCommon.md) & \{ `reviewGithubId?`: `number` \| `null`; `reviewSnippet?`: `string` \| `null`; `reviewUrl?`: `string` \| `null`; `state`: [`GithubPrReviewState`](GithubPrReviewState.md); \}

Metadata for a notification that a review was submitted on the user's GitHub pull request.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `reviewGithubId?` | `number` \| `null` | The GitHub numeric id of the review, when available. |
| `reviewSnippet?` | `string` \| `null` | A truncated excerpt of the review body, when any was written. |
| `reviewUrl?` | `string` \| `null` | The public GitHub URL for the review, when available. |
| `state` | [`GithubPrReviewState`](GithubPrReviewState.md) | The review decision state. |
