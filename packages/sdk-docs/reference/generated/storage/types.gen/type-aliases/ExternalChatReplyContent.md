# Type Alias: ExternalChatReplyContent

> **ExternalChatReplyContent** = \{ `mentions?`: `string`[]; `text`: `string`; `type`: `"text"`; \} \| \{ `caption?`: `string` \| `null`; `type`: `"media"`; `uploadId`: `string`; \} \| \{ `messageId`: `string`; `operation`: [`ExternalChatMutation`](ExternalChatMutation.md); `text?`: `string` \| `null`; `type`: `"mutation"`; \}

Content of a deliberate send.

## Union Members

### Type Literal

\{ `mentions?`: `string`[]; `text`: `string`; `type`: `"text"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `mentions?` | `string`[] | Group participants the text @-mentions, by their WhatsApp id (`jid` of a roster participant); the text must contain `@<digits before the @ of the id>` for each. |
| `text` | `string` | UTF-8 text, at most [`TEXT_LIMIT_BYTES`] bytes. |
| `type` | `"text"` | - |

***

### Type Literal

\{ `caption?`: `string` \| `null`; `type`: `"media"`; `uploadId`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `caption?` | `string` \| `null` | Optional caption; audio has none. |
| `type` | `"media"` | - |
| `uploadId` | `string` | The staged upload, imported as the message's static file. |

***

### Type Literal

\{ `messageId`: `string`; `operation`: [`ExternalChatMutation`](ExternalChatMutation.md); `text?`: `string` \| `null`; `type`: `"mutation"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `messageId` | `string` | Existing message, resolved to its provider source by the server. |
| `operation` | [`ExternalChatMutation`](ExternalChatMutation.md) | Explicit operation. |
| `text?` | `string` \| `null` | Replacement text or emoji; absent for delete, empty to remove a reaction. |
| `type` | `"mutation"` | - |
