# Type Alias: QueryStatement

> **QueryStatement** = `Extract`\<[`SqlStatement`](../../../../../generated/storage/types.gen/type-aliases/SqlStatement.md), \{ `kind`: `"select"`; \}\> \| \{ `database`: [`Database`](../../database/classes/Database.md); `kind`: `"schema"`; `summary`: `string`; \} \| \{ `kind`: `"insert"` \| `"update"` \| `"delete"`; `table`: [`DatabaseTable`](../../table/classes/DatabaseTable.md); `tableName`: `string`; \} \| \{ `column`: [`DatabaseColumn`](../../column/classes/DatabaseColumn.md); `columnName`: `string`; `kind`: `"alterColumnType"`; `table`: [`DatabaseTable`](../../table/classes/DatabaseTable.md); `tableName`: `string`; `to`: `string`; \}

What ran, with typed handles for resources written by the statement.

## Union Members

`Extract`\<[`SqlStatement`](../../../../../generated/storage/types.gen/type-aliases/SqlStatement.md), \{ `kind`: `"select"`; \}\>

***

### Type Literal

\{ `database`: [`Database`](../../database/classes/Database.md); `kind`: `"schema"`; `summary`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `database` | [`Database`](../../database/classes/Database.md) | Database whose schema changed. |
| `kind` | `"schema"` | Schema change discriminator. |
| `summary` | `string` | Human-readable description of the schema change. |

***

### Type Literal

\{ `kind`: `"insert"` \| `"update"` \| `"delete"`; `table`: [`DatabaseTable`](../../table/classes/DatabaseTable.md); `tableName`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"insert"` \| `"update"` \| `"delete"` | Row mutation discriminator. |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | Table targeted by the mutation, including zero-match writes. |
| `tableName` | `string` | SQL name of the target table. |

***

### Type Literal

\{ `column`: [`DatabaseColumn`](../../column/classes/DatabaseColumn.md); `columnName`: `string`; `kind`: `"alterColumnType"`; `table`: [`DatabaseTable`](../../table/classes/DatabaseTable.md); `tableName`: `string`; `to`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) | Column whose type changed. |
| `columnName` | `string` | SQL name of the changed column. |
| `kind` | `"alterColumnType"` | Column type change discriminator. |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | Table containing the changed column. |
| `tableName` | `string` | SQL name of the target table. |
| `to` | `string` | SQL type requested by the statement. |
