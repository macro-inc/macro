# Type Alias: GetTypedNotificationsByEventItemIdData

> **GetTypedNotificationsByEventItemIdData** = \{ `body?`: `never`; `path`: \{ `event_item_id`: `string`; \}; `query?`: \{ `cursor?`: `string`; `limit?`: `number`; `states?`: `string`; \}; `url`: `"/v1/user_notifications/item/{event_item_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `event_item_id`: `string`; \} | - |
| `path.event_item_id` | `string` | The event item ID |
| <a id="property-query"></a> `query?` | \{ `cursor?`: `string`; `limit?`: `number`; `states?`: `string`; \} | - |
| `query.cursor?` | `string` | Cursor value. Base64 encoded timestamp and item id. |
| `query.limit?` | `number` | Size limit per page. |
| `query.states?` | `string` | Comma-separated exact states: unseen,seen,done. Omitted defaults to unseen,seen; empty includes all states. |
| <a id="property-url"></a> `url` | `"/v1/user_notifications/item/{event_item_id}"` | - |
