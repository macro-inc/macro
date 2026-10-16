# Type Alias: DatabaseView

> **DatabaseView** = \{ `createdAt`: `string`; `databaseId`: `string`; `id`: `string`; `layout`: [`ViewLayout`](ViewLayout.md); `name`: `string`; `position`: `string`; `query`: [`ViewQuery`](ViewQuery.md); `tableId`: `string`; `updatedAt`: `string`; \}

A view of one table, as stored.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When it was created. |
| <a id="property-databaseid"></a> `databaseId` | `string` | The database the table belongs to. |
| <a id="property-id"></a> `id` | `string` | The view. |
| <a id="property-layout"></a> `layout` | [`ViewLayout`](ViewLayout.md) | How it draws them. |
| <a id="property-name"></a> `name` | `string` | Its name, unique among the table's views ignoring case. |
| <a id="property-position"></a> `position` | `string` | Where it sorts among the table's views: a fractional key. |
| <a id="property-query"></a> `query` | [`ViewQuery`](ViewQuery.md) | Which rows it shows, in what order. |
| <a id="property-tableid"></a> `tableId` | `string` | The table it shows. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | When it last changed. |
