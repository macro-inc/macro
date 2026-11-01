# Type Alias: UndoDatabaseChangeData

> **UndoDatabaseChangeData** = \{ `body?`: `never`; `path`: \{ `change`: `number`; `id`: `string`; \}; `query?`: `never`; `url`: `"/databases/{id}/changes/{change}/undo"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `change`: `number`; `id`: `string`; \} | - |
| `path.change` | `number` | The change's journal id |
| `path.id` | `string` | Database id |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/databases/{id}/changes/{change}/undo"` | - |
