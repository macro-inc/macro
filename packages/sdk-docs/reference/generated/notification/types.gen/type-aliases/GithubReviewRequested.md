# Type Alias: GithubReviewRequested

> **GithubReviewRequested** = [`GithubPrNotificationCommon`](GithubPrNotificationCommon.md) & \{ `requestedReviewerGithubLogin?`: `string` \| `null`; `requestedReviewerGithubUserId?`: `string` \| `null`; \}

Metadata for a notification that the user's review was requested on a GitHub pull request.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `requestedReviewerGithubLogin?` | `string` \| `null` | The GitHub login of the requested reviewer, when available. |
| `requestedReviewerGithubUserId?` | `string` \| `null` | The stable GitHub numeric user id of the requested reviewer, serialized as a string. |
