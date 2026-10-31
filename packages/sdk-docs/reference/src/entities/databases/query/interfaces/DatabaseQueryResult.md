# Interface: DatabaseQueryResult

The committed outcome of one statement; write calls are never automatically retried.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changesapplied"></a> `changesApplied` | `number` | Number of changes committed by the statement. |
| <a id="property-insertedrows"></a> `insertedRows` | [`DatabaseRow`](../../row/classes/DatabaseRow.md)[] | Handles for newly inserted rows, in insertion order. |
| <a id="property-newversions"></a> `newVersions` | [`QueryTableVersion`](QueryTableVersion.md)[] | Versions of tables after committed writes. |
| <a id="property-readversions"></a> `readVersions` | [`QueryTableVersion`](QueryTableVersion.md)[] | Observed table versions, reusable as guards for a later write. |
| <a id="property-result"></a> `result?` | [`QueryResultSet`](QueryResultSet.md) | Returned result set, when the statement produces one. |
| <a id="property-statement"></a> `statement` | [`QueryStatement`](../type-aliases/QueryStatement.md) | Statement classification with typed handles for its targets. |
| <a id="property-truncatedtables"></a> `truncatedTables` | `string`[] | SQL table names whose input hit the server row cap; aggregates may be partial. |
