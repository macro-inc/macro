# Type Alias: InferColumnTypeOutcome

> **InferColumnTypeOutcome** = \{ `column`: [`ColumnDetail`](ColumnDetail.md); `table_version`: [`TableVersion`](TableVersion.md); \}

Settled schema and the version against which its first value can be written.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-column"></a> `column` | [`ColumnDetail`](ColumnDetail.md) | Updated placement, property definition, and SQL name. |
| <a id="property-table_version"></a> `table_version` | [`TableVersion`](TableVersion.md) | Version after settling the column. |
