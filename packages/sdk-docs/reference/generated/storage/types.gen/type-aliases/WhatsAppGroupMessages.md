# Type Alias: WhatsAppGroupMessages

> **WhatsAppGroupMessages** = \{ `messages`: [`WhatsAppGroupMessage`](WhatsAppGroupMessage.md)[]; `next_cursor?`: `string` \| `null`; \}

Newest-first timeline page; `before` is the last returned message id.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-messages"></a> `messages` | [`WhatsAppGroupMessage`](WhatsAppGroupMessage.md)[] | Messages in descending sent_at, id order. |
| <a id="property-next_cursor"></a> `next_cursor?` | `string` \| `null` | Cursor for older messages. |
