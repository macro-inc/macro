# Type Alias: MessageReadReceipt

> **MessageReadReceipt** = \{ `first_opened_at?`: `string` \| `null`; `last_opened_at?`: `string` \| `null`; `message_id`: `string`; `open_count`: `number`; \}

Open state of one tracked, sent message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-first_opened_at"></a> `first_opened_at?` | `string` \| `null` | First counted fetch. |
| <a id="property-last_opened_at"></a> `last_opened_at?` | `string` \| `null` | Latest counted fetch. |
| <a id="property-message_id"></a> `message_id` | `string` | The tracked message. |
| <a id="property-open_count"></a> `open_count` | `number` | Counted pixel fetches. |
