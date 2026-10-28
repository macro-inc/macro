# Type Alias: GithubPrMention

> **GithubPrMention** = [`GithubPrNotificationCommon`](GithubPrNotificationCommon.md) & \{ `commentGithubId?`: `number` \| `null`; `commentUrl?`: `string` \| `null`; `location`: [`GithubPrMentionLocation`](GithubPrMentionLocation.md); `textSnippet`: `string`; \}

Metadata for a notification that the user was mentioned on a GitHub pull request.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `commentGithubId?` | `number` \| `null` | The GitHub numeric id of the comment or review containing the mention, when available. |
| `commentUrl?` | `string` \| `null` | The public GitHub URL for the text containing the mention, when available. |
| `location` | [`GithubPrMentionLocation`](GithubPrMentionLocation.md) | Where the mention appeared. |
| `textSnippet` | `string` | A truncated excerpt of the text containing the mention. |
