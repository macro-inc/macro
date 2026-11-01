# Type Alias: ColumnDetail

> **ColumnDetail** = \{ `column`: [`Column`](Column.md); `definition`: [`PropertyDefinitionWithOptions`](PropertyDefinitionWithOptions.md); `shared_outside_database`: `boolean`; `sql_name`: `string`; `writable`: `boolean`; \}

One column placement with the definition behind it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-column"></a> `column` | [`Column`](Column.md) | The placement. |
| <a id="property-definition"></a> `definition` | [`PropertyDefinitionWithOptions`](PropertyDefinitionWithOptions.md) | The bound definition (name, type, options). |
| <a id="property-shared_outside_database"></a> `shared_outside_database` | `boolean` | Whether the definition belongs to something beyond this database (a person's, a team's or a system property), so changing its options changes them everywhere that property is used. |
| <a id="property-sql_name"></a> `sql_name` | `string` | The name SQL refers to the column by: its display name, quoted. |
| <a id="property-writable"></a> `writable` | `boolean` | Whether SQL may write this column. |
