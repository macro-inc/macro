# Type Alias: RowHistoryEntry

> **RowHistoryEntry** = \{ `actingBot`: `string` \| `null`; `actor`: `string` \| `null`; `after`: \{\[`key`: `string`\]: [`CellValue`](CellValue.md); \}; `at`: `string`; `before`: \{\[`key`: `string`\]: [`CellValue`](CellValue.md); \}; `change`: `number`; `columns`: `string`[]; `kind`: [`RowChangeKind`](RowChangeKind.md); `version`: `number`; \}

One change of a row, as its history shows it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actingbot"></a> `actingBot` | `string` \| `null` | The agent acting for them, if one was. |
| <a id="property-actor"></a> `actor` | `string` \| `null` | Who made it; `null` for an internal caller, or a removed user. |
| <a id="property-after"></a> `after` | \{\[`key`: `string`\]: [`CellValue`](CellValue.md); \} | Those columns' values it wrote, by column id; a cell it emptied is left out. |
| <a id="property-at"></a> `at` | `string` | When it committed. |
| <a id="property-before"></a> `before` | \{\[`key`: `string`\]: [`CellValue`](CellValue.md); \} | Those columns' values before it, by column id; an empty cell is left out. |
| <a id="property-change"></a> `change` | `number` | The change's id in the journal. |
| <a id="property-columns"></a> `columns` | `string`[] | The columns it wrote; for a removal, those the row had values in. |
| <a id="property-kind"></a> `kind` | [`RowChangeKind`](RowChangeKind.md) | How it touched the row. |
| <a id="property-version"></a> `version` | `number` | The table version it produced. |
