# Type Alias: GithubPrNotificationCommon

> **GithubPrNotificationCommon** = \{ `displayName`: `string`; `foreignEntityId`: `string`; `githubKey`: `string`; `number`: `number`; `owner`: `string`; `repo`: `string`; `senderGithubAvatarUrl?`: `string` \| `null`; `senderGithubLogin?`: `string` \| `null`; `senderGithubUserId?`: `string` \| `null`; `title`: `string`; `url`: `string`; \}

Fields shared by every GitHub pull request notification type.

Embedded with `#[serde(flatten)]` so the wire shape keeps these keys at the
top level of the metadata object.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-displayname"></a> `displayName` | `string` | A compact label suitable for display in the UI. |
| <a id="property-foreignentityid"></a> `foreignEntityId` | `string` | The source-specific internal foreign entity row id for this pull request. |
| <a id="property-githubkey"></a> `githubKey` | `string` | The external GitHub key, in `owner/repo/pull/number` format. |
| <a id="property-number"></a> `number` | `number` | The GitHub pull request number. |
| <a id="property-owner"></a> `owner` | `string` | The GitHub repository owner or organization. |
| <a id="property-repo"></a> `repo` | `string` | The GitHub repository name. |
| <a id="property-sendergithubavatarurl"></a> `senderGithubAvatarUrl?` | `string` \| `null` | The GitHub avatar URL for the sender, when available. |
| <a id="property-sendergithublogin"></a> `senderGithubLogin?` | `string` \| `null` | The GitHub login for the sender, when available. |
| <a id="property-sendergithubuserid"></a> `senderGithubUserId?` | `string` \| `null` | The stable GitHub numeric user id for the sender, serialized as a string. |
| <a id="property-title"></a> `title` | `string` | The GitHub pull request title. Falls back to `display_name` when GitHub has no title. |
| <a id="property-url"></a> `url` | `string` | The public GitHub URL for the pull request. |
