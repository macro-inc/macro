# Interface: QueryResultSet

SQL returns dynamically shaped, discriminated cells and optional source row handles.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-columns"></a> `columns` | [`QueryColumn`](../type-aliases/QueryColumn.md)[] | Ordered metadata corresponding to each cell in a result row. |
| <a id="property-rowhandles"></a> `rowHandles` | [`DatabaseRow`](../../row/classes/DatabaseRow.md)[] | Source row handles in result order; empty for aggregates and virtual tables. |
| <a id="property-rows"></a> `rows` | ([`SqlCell`](../../../../../generated/storage/types.gen/type-aliases/SqlCell.md) \| `null`)[][] | Dynamic tagged cells in column order; empty cells are null. |
| <a id="property-sourcetable"></a> `sourceTable?` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | Persisted source table when results correspond to individual rows. |
