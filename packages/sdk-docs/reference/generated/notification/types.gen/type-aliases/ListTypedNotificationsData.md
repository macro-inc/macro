# Type Alias: ListTypedNotificationsData

> **ListTypedNotificationsData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `cursor?`: `string`; `limit?`: `number`; `states?`: `string`; \}; `url`: `"/v1/user_notifications"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `cursor?`: `string`; `limit?`: `number`; `states?`: `string`; \} | - |
| `query.cursor?` | `string` | Cursor value. Base64 encoded timestamp and item id. |
| `query.limit?` | `number` | Size limit per page. |
| `query.states?` | `string` | Comma-separated exact states: unseen,seen,done. Omitted defaults to unseen,seen; empty includes all states. |
| <a id="property-url"></a> `url` | `"/v1/user_notifications"` | - |
