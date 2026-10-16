# Type Alias: MessageChange

> **MessageChange** = \{ `mentions`: [`SimpleMention`](SimpleMention.md)[]; `message`: [`Message`](Message.md); `notification_policy`: [`PostMessageNotificationPolicy`](PostMessageNotificationPolicy.md); `type`: `"posted"`; \} \| \{ `mentions`: [`SimpleMention`](SimpleMention.md)[]; `message`: [`Message`](Message.md); `notification_policy`: [`PatchMessageNotificationPolicy`](PatchMessageNotificationPolicy.md); `previous_attachments`: [`MessageAttachment`](MessageAttachment.md)[]; `type`: `"edited"`; \} \| \{ `message`: [`Message`](Message.md); `type`: `"message_deleted"`; \} \| \{ `added`: `boolean`; `emoji`: `string`; `message`: [`Message`](Message.md); `type`: `"reaction_changed"`; \} \| \{ `state`: [`ThreadState`](ThreadState.md); `type`: `"thread_updated"`; \} \| \{ `active`: `boolean`; `agent?`: `null` \| [`AgentTyping`](AgentTyping.md); `thread_id?`: `string` \| `null`; `type`: `"typing"`; \}

Kind of message change; notification policy only runs for posted messages.

## Union Members

### Type Literal

\{ `mentions`: [`SimpleMention`](SimpleMention.md)[]; `message`: [`Message`](Message.md); `notification_policy`: [`PostMessageNotificationPolicy`](PostMessageNotificationPolicy.md); `type`: `"posted"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `mentions` | [`SimpleMention`](SimpleMention.md)[] | Mentions included in this post. |
| `message` | [`Message`](Message.md) | Persisted message. |
| `notification_policy` | [`PostMessageNotificationPolicy`](PostMessageNotificationPolicy.md) | Trusted notification policy carried with the committed change. |
| `type` | `"posted"` | - |

***

### Type Literal

\{ `mentions`: [`SimpleMention`](SimpleMention.md)[]; `message`: [`Message`](Message.md); `notification_policy`: [`PatchMessageNotificationPolicy`](PatchMessageNotificationPolicy.md); `previous_attachments`: [`MessageAttachment`](MessageAttachment.md)[]; `type`: `"edited"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `mentions` | [`SimpleMention`](SimpleMention.md)[] | Complete replacement mention set. |
| `message` | [`Message`](Message.md) | Persisted replacement message. |
| `notification_policy` | [`PatchMessageNotificationPolicy`](PatchMessageNotificationPolicy.md) | Trusted notification policy for the edited content. |
| `previous_attachments` | [`MessageAttachment`](MessageAttachment.md)[] | Attachment identities before the edit, for channel change delivery. |
| `type` | `"edited"` | - |

***

### Type Literal

\{ `message`: [`Message`](Message.md); `type`: `"message_deleted"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `message` | [`Message`](Message.md) | Persisted tombstone. |
| `type` | `"message_deleted"` | - |

***

### Type Literal

\{ `added`: `boolean`; `emoji`: `string`; `message`: [`Message`](Message.md); `type`: `"reaction_changed"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `added` | `boolean` | Whether the reaction was added (`true`) or removed (`false`). |
| `emoji` | `string` | Emoji whose membership changed. |
| `message` | [`Message`](Message.md) | Persisted message. |
| `type` | `"reaction_changed"` | - |

***

### Type Literal

\{ `state`: [`ThreadState`](ThreadState.md); `type`: `"thread_updated"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `state` | [`ThreadState`](ThreadState.md) | Persisted thread state. |
| `type` | `"thread_updated"` | - |

***

### Type Literal

\{ `active`: `boolean`; `agent?`: `null` \| [`AgentTyping`](AgentTyping.md); `thread_id?`: `string` \| `null`; `type`: `"typing"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `active` | `boolean` | Whether the user is currently typing. |
| `agent?` | `null` \| [`AgentTyping`](AgentTyping.md) | - |
| `thread_id?` | `string` \| `null` | Root being replied to, or no root for the parent composer. |
| `type` | `"typing"` | - |
