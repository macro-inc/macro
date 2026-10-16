# Class: DatabaseTable

One table (tab) of a [Database](../../database/classes/Database.md).

A table is not an entity of its own — it is owned and shared as part of its
database, and has no endpoint to read it directly. The handle resolves
through [Database.schema](../../database/classes/Database.md#schema), so reads after a write see the new state.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-database"></a> `database` | `readonly` | [`Database`](../../database/classes/Database.md) | The database this table belongs to. |
| <a id="property-id"></a> `id` | `readonly` | `string` | Identifier of the table. |

## Methods

### addColumn()

> **addColumn**(`options`): `Promise`\<[`DatabaseColumn`](../../column/classes/DatabaseColumn.md)\>

Add a column to this table. See [Database.addColumn](../../database/classes/Database.md#addcolumn).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`AddColumnOptions`](../../database/type-aliases/AddColumnOptions.md) |

#### Returns

`Promise`\<[`DatabaseColumn`](../../column/classes/DatabaseColumn.md)\>

***

### columns()

> **columns**(): `Promise`\<[`DatabaseColumn`](../../column/classes/DatabaseColumn.md)[]\>

The table's columns, in display order.

#### Returns

`Promise`\<[`DatabaseColumn`](../../column/classes/DatabaseColumn.md)[]\>

***

### createWebhook()

> **createWebhook**(): `Promise`\<\{ `token`: `string`; `webhook`: [`DatabaseWebhook`](../../webhook/classes/DatabaseWebhook.md); \}\>

Create a webhook that inserts rows here. See [Database.createWebhook](../../database/classes/Database.md#createwebhook).

#### Returns

`Promise`\<\{ `token`: `string`; `webhook`: [`DatabaseWebhook`](../../webhook/classes/DatabaseWebhook.md); \}\>

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this table. See [Database.deleteTable](../../database/classes/Database.md#deletetable).

#### Returns

`Promise`\<`void`\>

***

### detail()

> **detail**(): `Promise`\<[`TableDetail`](../../../../../generated/storage/types.gen/type-aliases/TableDetail.md)\>

The table's record as the API returns it: the table, its columns, and
its views.

#### Returns

`Promise`\<[`TableDetail`](../../../../../generated/storage/types.gen/type-aliases/TableDetail.md)\>

***

### name()

> **name**(): `Promise`\<`string`\>

The table's display name.

#### Returns

`Promise`\<`string`\>

***

### position()

> **position**(): `Promise`\<`string`\>

The table's fractional index within the database's tab order.

#### Returns

`Promise`\<`string`\>

***

### rename()

> **rename**(`name`): `Promise`\<`DatabaseTable`\>

Rename only if the last-read display name is still current.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`DatabaseTable`\>

***

### reorderColumns()

> **reorderColumns**(`columns`): `Promise`\<`DatabaseTable`\>

Persist a new column order. See [Database.reorderColumns](../../database/classes/Database.md#reordercolumns).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `columns` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md)[] |

#### Returns

`Promise`\<`DatabaseTable`\>

***

### row()

> **row**(`id`): [`DatabaseRow`](../../row/classes/DatabaseRow.md)

A handle to one of the table's rows, by the id an insert answered.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`DatabaseRow`](../../row/classes/DatabaseRow.md)

***

### toJSON()

> **toJSON**(): \{ `databaseId`: `string`; `id`: `string`; \}

#### Returns

\{ `databaseId`: `string`; `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `databaseId` | `string` |
| `id` | `string` |

***

### version()

> **version**(): `Promise`\<`number`\>

The table's current version, bumped by every committed change to its
schema or rows. Schema edits such as [reorderColumns](#reordercolumns) send it as
the base version they were made against, so a table that moved since
refuses the edit with a 409.

#### Returns

`Promise`\<`number`\>

***

### views()

> **views**(): `Promise`\<[`DatabaseView`](../../view/classes/DatabaseView.md)[]\>

The table's views, in their order.

#### Returns

`Promise`\<[`DatabaseView`](../../view/classes/DatabaseView.md)[]\>

***

### byId()

> `static` **byId**(`database`, `id`): `DatabaseTable`

A handle to a table by id, within a database. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `database` | [`Database`](../../database/classes/Database.md) |
| `id` | `string` |

#### Returns

`DatabaseTable`
