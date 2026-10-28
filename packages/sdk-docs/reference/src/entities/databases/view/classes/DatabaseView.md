# Class: DatabaseView

One view of a [DatabaseTable](../../table/classes/DatabaseTable.md): which of its rows to show, in what
order, drawn as a table or a board.

A view is not an entity of its own — it is owned and shared as part of its
database. The handle resolves through the database's schema, so a fresh
read after a write sees the new value. Views are created, changed, and
reordered with ops; see Database.applyOps.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` | Identifier of the view. |
| <a id="property-table"></a> `table` | `readonly` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | The table this view shows. |

## Methods

### detail()

> **detail**(): `Promise`\<[`DatabaseView`](../../../../../generated/storage/types.gen/type-aliases/DatabaseView.md)\>

The view's record as the API returns it.

#### Returns

`Promise`\<[`DatabaseView`](../../../../../generated/storage/types.gen/type-aliases/DatabaseView.md)\>

***

### layout()

> **layout**(): `Promise`\<[`ViewLayout`](../../../../../generated/storage/types.gen/type-aliases/ViewLayout.md)\>

How the view draws its rows: a table, or a board grouped by a column.

#### Returns

`Promise`\<[`ViewLayout`](../../../../../generated/storage/types.gen/type-aliases/ViewLayout.md)\>

***

### name()

> **name**(): `Promise`\<`string`\>

The view's name, unique among its table's views ignoring case.

#### Returns

`Promise`\<`string`\>

***

### position()

> **position**(): `Promise`\<`string`\>

The view's fractional index within its table's views.

#### Returns

`Promise`\<`string`\>

***

### positions()

> **positions**(): `Promise`\<[`CardPosition`](../../../../../generated/storage/types.gen/type-aliases/CardPosition.md)[]\>

Where a board's cards sit: each placed card's lane and its key there.
Cards without a place show after the placed ones of their lane, oldest
first.

#### Returns

`Promise`\<[`CardPosition`](../../../../../generated/storage/types.gen/type-aliases/CardPosition.md)[]\>

***

### query()

> **query**(): `Promise`\<[`ViewQuery`](../../../../../generated/storage/types.gen/type-aliases/ViewQuery.md)\>

Which rows the view shows, and in what order.

#### Returns

`Promise`\<[`ViewQuery`](../../../../../generated/storage/types.gen/type-aliases/ViewQuery.md)\>

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

> `static` **byId**(`table`, `id`): `DatabaseView`

A handle to a view by id, within a table. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |
| `id` | `string` |

#### Returns

`DatabaseView`
