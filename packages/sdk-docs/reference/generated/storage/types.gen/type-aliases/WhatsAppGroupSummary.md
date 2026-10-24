# Type Alias: WhatsAppGroupSummary

> **WhatsAppGroupSummary** = \{ `backfill?`: `null` \| [`LinkedBackfill`](LinkedBackfill.md); `can_send`: `boolean`; `id`: `string`; `last_message_at?`: `string` \| `null`; `name`: `string`; `send_reason?`: `null` \| [`LinkedReplyBlock`](LinkedReplyBlock.md); `unread_count`: `number`; `user_id`: `string`; \}

Adopted group visible through ordinary entity sharing.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-backfill"></a> `backfill?` | `null` \| [`LinkedBackfill`](LinkedBackfill.md) | - |
| <a id="property-can_send"></a> `can_send` | `boolean` | Caller may currently send from their own account. |
| <a id="property-id"></a> `id` | `string` | Entity identifier. |
| <a id="property-last_message_at"></a> `last_message_at?` | `string` \| `null` | Latest message timestamp. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-send_reason"></a> `send_reason?` | `null` \| [`LinkedReplyBlock`](LinkedReplyBlock.md) | - |
| <a id="property-unread_count"></a> `unread_count` | `number` | Unread live messages for this viewer. |
| <a id="property-user_id"></a> `user_id` | `string` | Actual entity owner. |
