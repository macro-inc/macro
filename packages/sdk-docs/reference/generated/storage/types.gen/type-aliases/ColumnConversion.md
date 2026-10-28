# Type Alias: ColumnConversion

> **ColumnConversion** = \{ `cells`: [`ConvertedCell`](ConvertedCell.md)[]; `misfits`: `number`; `options`: `string`[]; `tableVersion`: [`TableVersion`](TableVersion.md); \}

What a column's values become under another type, for a new column of
that type beside it: the values that convert, the options they need,
and how many do not convert. Nothing is changed by reading it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-cells"></a> `cells` | [`ConvertedCell`](ConvertedCell.md)[] | Each row whose value converts, with that value, options named by label. |
| <a id="property-misfits"></a> `misfits` | `number` | How many values do not convert, and are left out. |
| <a id="property-options"></a> `options` | `string`[] | The option labels a new select or tag column needs, in order. |
| <a id="property-tableversion"></a> `tableVersion` | [`TableVersion`](TableVersion.md) | The table's version the cells were read at; a batch writing the new column sends it as its base version. |
