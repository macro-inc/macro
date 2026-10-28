# Class: DatabaseRow

One row of a [DatabaseTable](../../table/classes/DatabaseTable.md).

A row is not an entity of its own — it is owned and shared as part of its
database. Its cells are written with ops; see Database.applyOps.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` | Identifier of the row. |
| <a id="property-table"></a> `table` | `readonly` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | The table this row belongs to. |

## Methods

### history()

> **history**(): `Promise`\<[`RowHistoryEntry`](../../../../../generated/storage/types.gen/type-aliases/RowHistoryEntry.md)[]\>

Every committed change that touched the row, newest first: who made it,
when, how, and the values of the columns it touched before and after.
A removed row's history still reads.

#### Returns

`Promise`\<[`RowHistoryEntry`](../../../../../generated/storage/types.gen/type-aliases/RowHistoryEntry.md)[]\>

***

### toJSON()

> **toJSON**(): \{ `id`: `string`; `tableId`: `string`; \}

#### Returns

\{ `id`: `string`; `tableId`: `string`; \}

| Name | Type |
| ------ | ------ |
| `id` | `string` |
| `tableId` | `string` |

***

### byId()

> `static` **byId**(`table`, `id`): `DatabaseRow`

A handle to a row by id, within a table.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |
| `id` | `string` |

#### Returns

`DatabaseRow`
