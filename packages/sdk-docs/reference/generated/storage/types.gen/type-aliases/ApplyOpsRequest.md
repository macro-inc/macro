# Type Alias: ApplyOpsRequest

> **ApplyOpsRequest** = \{ `baseVersions?`: \{\[`key`: `string`\]: `number`; \}; `ops`: [`DatabaseOp`](DatabaseOp.md)[]; \}

A batch of ops for one database, applied in order, in one transaction,
together or not at all.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-baseversions"></a> `baseVersions?` | \{\[`key`: `string`\]: `number`; \} | The version each named table must still be at, as the caller read it. A table that moved refuses the batch as a conflict, so a schema edit made against what the caller saw does not overwrite another's. Left out, ops are last-write-wins. |
| <a id="property-ops"></a> `ops` | [`DatabaseOp`](DatabaseOp.md)[] | The ops, in the order they apply, each grouped by the resource it changes (`table`, `column`, `rows`, `view`, `reorder_tables`) with a `change` saying how. Every one names a table of this database, or one an earlier op of the batch creates: tables, columns, options and views carry ids the client mints (UUIDv7), so a later op can name them. An id that already names something refuses the batch. |
