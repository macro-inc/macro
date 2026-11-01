# Type Alias: TouchedRow

> **TouchedRow** = \{ `kind`: [`RowChangeKind`](RowChangeKind.md); `row`: `string`; \}

A row a table's changes since some version touched, and how it stands.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-kind"></a> `kind` | [`RowChangeKind`](RowChangeKind.md) | How it changed overall: added, written, or removed. |
| <a id="property-row"></a> `row` | `string` | The row. |
