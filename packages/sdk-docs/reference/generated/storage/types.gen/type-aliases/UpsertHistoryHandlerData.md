# Type Alias: UpsertHistoryHandlerData

> **UpsertHistoryHandlerData** = \{ `body?`: `never`; `path`: \{ `item_id`: `string`; `item_type`: `string`; \}; `query?`: `never`; `url`: `"/history/{item_type}/{item_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `item_id`: `string`; `item_type`: `string`; \} | - |
| `path.item_id` | `string` | ID of the item |
| `path.item_type` | `string` | Type of the item |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/history/{item_type}/{item_id}"` | - |
