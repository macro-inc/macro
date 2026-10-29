# Type Alias: GetChannelsData

> **GetChannelsData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `cursor?`: `string`; `limit?`: `number`; \}; `url`: `"/comms/channels"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `cursor?`: `string`; `limit?`: `number`; \} | - |
| `query.cursor?` | `string` | Opaque cursor for the next page |
| `query.limit?` | `number` | Page size (1-100, default 100) |
| <a id="property-url"></a> `url` | `"/comms/channels"` | - |
