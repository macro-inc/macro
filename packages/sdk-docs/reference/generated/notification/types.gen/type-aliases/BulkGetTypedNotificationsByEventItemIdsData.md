# Type Alias: BulkGetTypedNotificationsByEventItemIdsData

> **BulkGetTypedNotificationsByEventItemIdsData** = \{ `body`: [`BulkGetByEventItemIdsRequest`](BulkGetByEventItemIdsRequest.md); `path?`: `never`; `query?`: \{ `cursor?`: `string`; `limit?`: `number`; `states?`: `string`; \}; `url`: `"/v1/user_notifications/item/bulk"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`BulkGetByEventItemIdsRequest`](BulkGetByEventItemIdsRequest.md) | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `cursor?`: `string`; `limit?`: `number`; `states?`: `string`; \} | - |
| `query.cursor?` | `string` | Cursor value. Base64 encoded timestamp and item id. |
| `query.limit?` | `number` | Size limit per page. Default 20, max 500. |
| `query.states?` | `string` | Comma-separated exact states: unseen,seen,done. Omitted defaults to unseen,seen; empty includes all states. |
| <a id="property-url"></a> `url` | `"/v1/user_notifications/item/bulk"` | - |
