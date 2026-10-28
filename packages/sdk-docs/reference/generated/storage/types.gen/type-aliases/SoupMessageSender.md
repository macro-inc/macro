# Type Alias: SoupMessageSender

> **SoupMessageSender** = \{ `avatar_url?`: `string` \| `null`; `id`: `string`; `name?`: `string` \| `null`; `type`: [`SoupMessageSenderType`](SoupMessageSenderType.md); \}

Public sender identity for soup channel messages.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-avatar_url"></a> `avatar_url?` | `string` \| `null` | Avatar URL for bot senders. |
| <a id="property-id"></a> `id` | `string` | Sender id without the storage namespace prefix. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name for bot senders. |
| <a id="property-type"></a> `type` | [`SoupMessageSenderType`](SoupMessageSenderType.md) | Sender type. |
