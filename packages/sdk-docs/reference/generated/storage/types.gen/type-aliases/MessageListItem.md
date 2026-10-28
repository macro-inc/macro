# Type Alias: MessageListItem

> **MessageListItem** = [`Message`](Message.md) & \{ `state`: [`ThreadState`](ThreadState.md); `thread`: [`MessageThreadPreview`](MessageThreadPreview.md); \}

Root message with its small thread preview, independent of its parent type.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `state` | [`ThreadState`](ThreadState.md) | Thread metadata, independent of the first message's lifecycle. |
| `thread` | [`MessageThreadPreview`](MessageThreadPreview.md) | Bounded reply preview; full replies load on expansion. |
