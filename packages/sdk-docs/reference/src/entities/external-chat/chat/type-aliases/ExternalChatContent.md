# Type Alias: ExternalChatContent

> **ExternalChatContent** = \{ `mentions?`: [`ExternalChatParticipant`](../../participant/classes/ExternalChatParticipant.md)[]; `text`: `string`; `type`: `"text"`; \} \| \{ `caption?`: `string`; `type`: `"media"`; `upload`: [`ExternalChatUpload`](../../upload/classes/ExternalChatUpload.md); \} \| \{ `message`: [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md); `operation`: `"reaction"` \| `"edit"` \| `"delete"`; `text?`: `string`; `type`: `"mutation"`; \}

Deliberate content sent from the credential owner's own provider account.

## Union Members

### Type Literal

\{ `mentions?`: [`ExternalChatParticipant`](../../participant/classes/ExternalChatParticipant.md)[]; `text`: `string`; `type`: `"text"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `mentions?` | [`ExternalChatParticipant`](../../participant/classes/ExternalChatParticipant.md)[] | Participants mentioned (from `participants()`); the text names each as `@<mentionToken>`. |
| `text` | `string` | - |
| `type` | `"text"` | - |

***

### Type Literal

\{ `caption?`: `string`; `type`: `"media"`; `upload`: [`ExternalChatUpload`](../../upload/classes/ExternalChatUpload.md); \}

***

### Type Literal

\{ `message`: [`ExternalChatMessage`](../../message/classes/ExternalChatMessage.md); `operation`: `"reaction"` \| `"edit"` \| `"delete"`; `text?`: `string`; `type`: `"mutation"`; \}
