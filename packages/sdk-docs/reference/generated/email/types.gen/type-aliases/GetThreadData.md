# Type Alias: GetThreadData

> **GetThreadData** = \{ `body?`: `never`; `path`: \{ `thread_id`: `string`; \}; `query?`: \{ `limit?`: `number`; `offset?`: `number`; \}; `url`: `"/email/threads/{thread_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `thread_id`: `string`; \} | - |
| `path.thread_id` | `string` | Thread ID |
| <a id="property-query"></a> `query?` | \{ `limit?`: `number`; `offset?`: `number`; \} | - |
| `query.limit?` | `number` | Limit for message pagination. Default is 5, max 100. |
| `query.offset?` | `number` | Offset for message pagination. Default is 0. |
| <a id="property-url"></a> `url` | `"/email/threads/{thread_id}"` | - |
