# Type Alias: TableChanged

> **TableChanged** = \{ `databaseId`: `string`; `tableId`: `string`; `version`: [`TableVersion`](TableVersion.md); \}

The [`TABLE_CHANGED_MESSAGE_TYPE`] payload: one table's new version.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-databaseid"></a> `databaseId` | `string` | The database the table belongs to. |
| <a id="property-tableid"></a> `tableId` | `string` | The table that changed. |
| <a id="property-version"></a> `version` | [`TableVersion`](TableVersion.md) | The table's version after the write. |
