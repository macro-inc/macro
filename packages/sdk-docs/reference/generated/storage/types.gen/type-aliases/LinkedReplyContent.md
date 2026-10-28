# Type Alias: LinkedReplyContent

> **LinkedReplyContent** = \{ `mentions?`: `string`[]; `text`: `string`; `type`: `"text"`; \} \| \{ `caption?`: `string` \| `null`; `type`: `"media"`; `uploadId`: `string`; \} \| \{ `messageId`: `string`; `operation`: [`LinkedMutation`](LinkedMutation.md); `text?`: `string` \| `null`; `type`: `"mutation"`; \}

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

\{ `messageId`: `string`; `operation`: [`LinkedMutation`](LinkedMutation.md); `text?`: `string` \| `null`; `type`: `"mutation"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `messageId` | `string` | Existing group message, resolved to its WhatsApp source by the server. |
| `operation` | [`LinkedMutation`](LinkedMutation.md) | Explicit operation. |
| `text?` | `string` \| `null` | Replacement text or emoji; absent for delete, empty to remove a reaction. |
| `type` | `"mutation"` | - |
