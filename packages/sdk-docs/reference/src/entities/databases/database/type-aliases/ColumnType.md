# Type Alias: ColumnType

> **ColumnType** = `Exclude`\<[`ColumnKind`](../../../../../generated/storage/types.gen/type-aliases/ColumnKind.md), \{ `type`: `"relation"`; \}\> \| \{ `table`: [`DatabaseTable`](../../table/classes/DatabaseTable.md); `type`: `"relation"`; \}

A type a column can have. A relation names the related table by handle;
the table may live in any database the caller can reach.
