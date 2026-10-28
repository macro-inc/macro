# Type Alias: GetThreadMessagesHandlerData

> **GetThreadMessagesHandlerData** = \{ `body?`: `never`; `path`: \{ `id`: `string`; \}; `query?`: \{ `limit?`: `number`; `since?`: `string`; \}; `url`: `"/email/threads/{id}/messages"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; \} | - |
| `path.id` | `string` | Thread ID |
| <a id="property-query"></a> `query?` | \{ `limit?`: `number`; `since?`: `string`; \} | - |
| `query.limit?` | `number` | Limit number of messages returned |
| `query.since?` | `string` | Filter messages after this date |
| <a id="property-url"></a> `url` | `"/email/threads/{id}/messages"` | - |
