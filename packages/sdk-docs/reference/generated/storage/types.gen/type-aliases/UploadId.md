# Type Alias: UploadId

> **UploadId** = \{ `kind`: `"users"`; \} \| \{ `kind`: `"conversation_part"`; `partIndex`: `number`; `slackChannelId`: [`ConversationId`](ConversationId.md); \}

Identity in a job's persisted manifest. No user-supplied object keys.

## Union Members

### Type Literal

\{ `kind`: `"users"`; \}

***

### Type Literal

\{ `kind`: `"conversation_part"`; `partIndex`: `number`; `slackChannelId`: [`ConversationId`](ConversationId.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"conversation_part"` | - |
| `partIndex` | `number` | Zero-based part index; sealed manifests must be contiguous. |
| `slackChannelId` | [`ConversationId`](ConversationId.md) | Selected Slack conversation. |
