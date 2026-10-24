# Type Alias: WhatsappGroupMessagesData

> **WhatsappGroupMessagesData** = \{ `body?`: `never`; `path`: \{ `group_id`: `string`; \}; `query?`: \{ `before?`: `string` \| `null`; `limit?`: `number` \| `null`; \}; `url`: `"/meta/linked/whatsapp-groups/{group_id}/messages"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `group_id`: `string`; \} | - |
| `path.group_id` | `string` | - |
| <a id="property-query"></a> `query?` | \{ `before?`: `string` \| `null`; `limit?`: `number` \| `null`; \} | - |
| `query.before?` | `string` \| `null` | Last message id in the previous page. |
| `query.limit?` | `number` \| `null` | Page size, 1 through 100. |
| <a id="property-url"></a> `url` | `"/meta/linked/whatsapp-groups/{group_id}/messages"` | - |
