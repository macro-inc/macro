# Type Alias: SqlOutcome

> **SqlOutcome** = \{ `changesApplied`: `number`; `insertedRowIds`: [`RowId`](RowId.md)[]; `newVersions`: \{\[`key`: `string`\]: `number`; \}; `readVersions`: \{\[`key`: `string`\]: `number`; \}; `result?`: `null` \| [`ResultSet`](ResultSet.md); `statement`: [`SqlStatement`](SqlStatement.md); `tableDatabases`: \{\[`key`: `string`\]: `string`; \}; `truncatedTables`: `string`[]; \}

The answer to one statement.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changesapplied"></a> `changesApplied` | `number` | How many rows a write changed. |
| <a id="property-insertedrowids"></a> `insertedRowIds` | [`RowId`](RowId.md)[] | The rows an `INSERT` created, in statement order. |
| <a id="property-newversions"></a> `newVersions` | \{\[`key`: `string`\]: `number`; \} | The new version of every table written. |
| <a id="property-readversions"></a> `readVersions` | \{\[`key`: `string`\]: `number`; \} | The version of every table read, for a follow-up write to guard on. |
| <a id="property-result"></a> `result?` | `null` \| [`ResultSet`](ResultSet.md) | - |
| <a id="property-statement"></a> `statement` | [`SqlStatement`](SqlStatement.md) | What kind of statement ran, and what it wrote. |
| <a id="property-tabledatabases"></a> `tableDatabases` | \{\[`key`: `string`\]: `string`; \} | Owning database of each visible table referenced by this outcome. |
| <a id="property-truncatedtables"></a> `truncatedTables` | `string`[] | Every table the statement read, when any read hit the engine's row cap: the engine reports the cap per statement, so aggregates over any of them may be partial. |
