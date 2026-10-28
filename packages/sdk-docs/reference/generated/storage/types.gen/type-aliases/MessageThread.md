# Type Alias: MessageThread

> **MessageThread** = \{ `replies`: [`Message`](Message.md)[]; `root`: [`Message`](Message.md); `state`: [`ThreadState`](ThreadState.md); \}

A discussion with its root and ordered replies, including root tombstones.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-replies"></a> `replies` | [`Message`](Message.md)[] | Replies in display order. |
| <a id="property-root"></a> `root` | [`Message`](Message.md) | Root message, which may be a tombstone. |
| <a id="property-state"></a> `state` | [`ThreadState`](ThreadState.md) | Shared thread lifecycle and anchor state. |
