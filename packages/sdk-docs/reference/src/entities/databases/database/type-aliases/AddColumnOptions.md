# Type Alias: AddColumnOptions

> **AddColumnOptions** = \{ `inferType?`: `boolean`; `name`: `string`; `options?`: `string`[]; `type`: [`ColumnType`](ColumnType.md); \} \| \{ `property`: [`PropertyDefinition`](../../../properties/property-definition/classes/PropertyDefinition.md); \} & \{ `after?`: [`DatabaseColumn`](../../column/classes/DatabaseColumn.md); \}

Options for [Database.addColumn](../classes/Database.md#addcolumn).

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `after?` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) | The column the new one goes right after; by default, the last one. |
