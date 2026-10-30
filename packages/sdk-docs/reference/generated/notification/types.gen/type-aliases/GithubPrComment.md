# Type Alias: GithubPrComment

> **GithubPrComment** = [`GithubPrNotificationCommon`](GithubPrNotificationCommon.md) & \{ `commentGithubId?`: `number` \| `null`; `commentKind`: [`GithubPrCommentKind`](GithubPrCommentKind.md); `commentSnippet`: `string`; `commentUrl?`: `string` \| `null`; \}

Metadata for a notification that a GitHub pull request was commented on.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `commentGithubId?` | `number` \| `null` | The GitHub numeric id of the comment, when available. |
| `commentKind` | [`GithubPrCommentKind`](GithubPrCommentKind.md) | The kind of comment that was posted. |
| `commentSnippet` | `string` | A truncated excerpt of the comment body. |
| `commentUrl?` | `string` \| `null` | The public GitHub URL for the comment, when available. |
