# Type Alias: StorageRowsQuery

> **StorageRowsQuery** = \{ `after?`: `null` \| [`RowId`](RowId.md); `query?`: [`ViewQuery`](ViewQuery.md); `rowIds?`: [`RowId`](RowId.md)[] \| `null`; \}

A query over one authorized storage table.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-after"></a> `after?` | `null` \| [`RowId`](RowId.md) | - |
| <a id="property-query"></a> `query?` | [`ViewQuery`](ViewQuery.md) | The common database filter and sort semantics. |
| <a id="property-rowids"></a> `rowIds?` | [`RowId`](RowId.md)[] \| `null` | Read these retained rows regardless of the active filter. |
