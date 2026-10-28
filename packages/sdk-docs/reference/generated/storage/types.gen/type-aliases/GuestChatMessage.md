# Type Alias: GuestChatMessage

> **GuestChatMessage** = \{ `content`: `string`; `created_at`: `string`; `guest`: `boolean`; `id`: `string`; `is_you`: `boolean`; `name`: `string`; \}

Guest-safe message projection: no account identities, attachments, or entity grants.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | `string` | Message body. |
| <a id="property-created_at"></a> `created_at` | `string` | Creation time. |
| <a id="property-guest"></a> `guest` | `boolean` | Whether the author is a guest. |
| <a id="property-id"></a> `id` | `string` | Persisted message identity. |
| <a id="property-is_you"></a> `is_you` | `boolean` | Whether this session authored the message. |
| <a id="property-name"></a> `name` | `string` | Display-only author name. |
