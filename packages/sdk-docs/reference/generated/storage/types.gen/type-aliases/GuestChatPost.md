# Type Alias: GuestChatPost

> **GuestChatPost** = \{ `content`: `string`; `id`: `string`; \}

Guests may send text only; attribution and parent are server-owned.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | `string` | Text to append to the call discussion. |
| <a id="property-id"></a> `id` | `string` | UUIDv7 used to deduplicate retries, including the first message. |
