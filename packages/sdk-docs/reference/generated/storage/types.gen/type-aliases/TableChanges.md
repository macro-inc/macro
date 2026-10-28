# Type Alias: TableChanges

> **TableChanges** = \{ `columns`: [`TouchedColumn`](TouchedColumn.md)[]; `complete`: `boolean`; `rows`: [`TouchedRow`](TouchedRow.md)[]; `truncated`: `boolean`; `version`: `number`; \}

What changed in a table since a version, for a reader holding it at
that version.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-columns"></a> `columns` | [`TouchedColumn`](TouchedColumn.md)[] | The columns that changed; any of them means the table's shape moved. |
| <a id="property-complete"></a> `complete` | `boolean` | Whether every version since is journaled; without it, read the table whole. |
| <a id="property-rows"></a> `rows` | [`TouchedRow`](TouchedRow.md)[] | The rows that changed, each once, as they stand now: a row added and written is `insert`, one removed is `delete`, and one added and removed since is left out. |
| <a id="property-truncated"></a> `truncated` | `boolean` | Whether more rows changed than are listed; then read the table whole. |
| <a id="property-version"></a> `version` | `number` | The version the changes reach. |
