# Type Alias: Column

> **Column** = \{ `config`: `null` \| [`ColumnConfig`](ColumnConfig.md); `display_name`: `string` \| `null`; `id`: `string`; `infer_type`: `boolean`; `nullable?`: `boolean`; `position`: `string`; `property_definition_id`: `string`; `protections?`: [`ColumnProtection`](ColumnProtection.md)[]; `table_id`: `string`; \}

A column: the placement of a property definition on a table.

The definition carries name, [`DataType`], multi-select flag, and options;
this carries only where it appears and column-kind configuration.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-config"></a> `config` | `null` \| [`ColumnConfig`](ColumnConfig.md) | - |
| <a id="property-display_name"></a> `display_name` | `string` \| `null` | The placement's own label, which also names it in SQL; `None` shows the definition's name. |
| <a id="property-id"></a> `id` | `string` | Identifier of the placement. |
| <a id="property-infer_type"></a> `infer_type` | `boolean` | Whether the first nonempty value may settle this new text column's type. |
| <a id="property-nullable"></a> `nullable?` | `boolean` | Whether a row may omit this cell; empty collections also count as absent. |
| <a id="property-position"></a> `position` | `string` | Fractional index for column ordering. |
| <a id="property-property_definition_id"></a> `property_definition_id` | `string` | The bound property definition. |
| <a id="property-protections"></a> `protections?` | [`ColumnProtection`](ColumnProtection.md)[] | Schema operations reserved by a feature; ordinary edits cannot clear them. |
| <a id="property-table_id"></a> `table_id` | `string` | Table the column appears on. |
