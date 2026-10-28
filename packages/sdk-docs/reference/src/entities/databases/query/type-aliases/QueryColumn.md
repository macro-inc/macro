# Type Alias: QueryColumn

> **QueryColumn** = `Omit`\<[`ResultColumn`](../../../../../generated/storage/types.gen/type-aliases/ResultColumn.md), `"relatedTable"`\> & \{ `relatedTable?`: [`DatabaseTable`](../../table/classes/DatabaseTable.md); \}

Result column metadata, including a typed relation target when visible.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `relatedTable?` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | Visible target table for a relation column. |
