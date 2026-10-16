# Type Alias: StorageRows

> **StorageRows** = \{ `next?`: `null` \| [`RowId`](RowId.md); `rows`: [`StorageRow`](StorageRow.md)[]; `version`: [`TableVersion`](TableVersion.md); \}

A bounded page of rows at a table version.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-next"></a> `next?` | `null` \| [`RowId`](RowId.md) | - |
| <a id="property-rows"></a> `rows` | [`StorageRow`](StorageRow.md)[] | Rows in the requested view's order. |
| <a id="property-version"></a> `version` | [`TableVersion`](TableVersion.md) | Table version when the read began. |
