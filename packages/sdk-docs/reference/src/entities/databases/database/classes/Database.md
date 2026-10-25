# Class: Database

A Macro database: a named collection of tables, owned and shared as one
entity.

A free-to-construct `(client, id)` handle like any other entity — the schema
loads lazily on first field access and is dropped after any mutation.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`DatabaseDetail`](../../../../../generated/storage/types.gen/type-aliases/DatabaseDetail.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-access"></a> `access` | `readonly` | [`EntityAccess`](../../../sharing/access/classes/EntityAccess.md) | Access requests and direct user grants. | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the database was created. | - |
| <a id="property-grant"></a> `grant` | `readonly` | () => `Promise`\<[`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md)\> | The caller's access on the database. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | The database's display name. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The user who owns the database. | - |
| <a id="property-tables"></a> `tables` | `readonly` | () => `Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md)[]\> | The database's tables, in tab order. | - |
| <a id="property-trashedat"></a> `trashedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | When the database was trashed, if it has been. | - |

## Methods

### addColumn()

> **addColumn**(`table`, `options`): `Promise`\<[`DatabaseColumn`](../../column/classes/DatabaseColumn.md)\>

Add a column to one of the database's tables, under an id minted here,
either creating a property definition for it or binding an existing one.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |
| `options` | [`AddColumnOptions`](../type-aliases/AddColumnOptions.md) |

#### Returns

`Promise`\<[`DatabaseColumn`](../../column/classes/DatabaseColumn.md)\>

***

### addColumnOptions()

> **addColumnOptions**(`column`, `labels`): `Promise`\<[`OpResultOf`](../type-aliases/OpResultOf.md)\<`"column"`, `"options_added"`\>\>

Add select options to one of the database's columns, each under an id
minted here. Labels the column already has are skipped, so the call is
safe to repeat; the result lists the options it did create. Only select
and tag columns accept options.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) |
| `labels` | `string`[] |

#### Returns

`Promise`\<[`OpResultOf`](../type-aliases/OpResultOf.md)\<`"column"`, `"options_added"`\>\>

***

### applyOps()

> **applyOps**(`ops`, `options?`): `Promise`\<[`OpResult`](../../../../../generated/storage/types.gen/type-aliases/OpResult.md)[]\>

Apply ops to the database in one transaction: create, rename, reorder,
or delete tables and columns; change a column's type; add, edit, or
delete select options; insert, update, or delete rows; create, change,
reorder, or delete views; move board cards. Later ops see what earlier
ones did, so a table or column created by one op (under an id the caller
mints, as a UUIDv7) can be named by the next. A refused op leaves the
whole batch unwritten and throws [MacroOpRefusedError](MacroOpRefusedError.md). Returns one
result per op, in the order sent.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ops` | [`DatabaseOp`](../../../../../generated/storage/types.gen/type-aliases/DatabaseOp.md)[] |
| `options?` | [`ApplyOpsOptions`](../type-aliases/ApplyOpsOptions.md) |

#### Returns

`Promise`\<[`OpResult`](../../../../../generated/storage/types.gen/type-aliases/OpResult.md)[]\>

***

### changeColumnType()

> **changeColumnType**(`column`, `options`): `Promise`\<[`OpResultOf`](../type-aliases/OpResultOf.md)\<`"column"`, `"type_changed"`\>\>

Change a column's type at the table version last read. Every value must
convert: one that does not refuses the change, naming how many and a few
of them, and nothing is written. To keep the original column, see
[Database.convertColumnIntoNewColumn](#convertcolumnintonewcolumn).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) |
| `options` | [`ChangeColumnTypeOptions`](../type-aliases/ChangeColumnTypeOptions.md) |

#### Returns

`Promise`\<[`OpResultOf`](../type-aliases/OpResultOf.md)\<`"column"`, `"type_changed"`\>\>

***

### columnCasts()

> **columnCasts**(`column`): `Promise`\<[`ColumnCast`](../../../../../generated/storage/types.gen/type-aliases/ColumnCast.md)[]\>

What changing a column to each type would do to its values. Changes
nothing.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) |

#### Returns

`Promise`\<[`ColumnCast`](../../../../../generated/storage/types.gen/type-aliases/ColumnCast.md)[]\>

***

### columnConversion()

> **columnConversion**(`column`, `to`): `Promise`\<[`ColumnConversion`](../../../../../generated/storage/types.gen/type-aliases/ColumnConversion.md)\>

What a column's values become under another type: the values that
convert, the option labels a new select or tag column of that type needs,
and how many values do not convert. Changes nothing.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) |
| `to` | [`ColumnType`](../type-aliases/ColumnType.md) |

#### Returns

`Promise`\<[`ColumnConversion`](../../../../../generated/storage/types.gen/type-aliases/ColumnConversion.md)\>

***

### convertColumnIntoNewColumn()

> **convertColumnIntoNewColumn**(`column`, `options`): `Promise`\<[`DatabaseColumn`](../../column/classes/DatabaseColumn.md)\>

Add a column of another type right after this one, filled with the
values that convert, in one batch at the table version the conversion
was read at. The original column is left as it is; values that do not
convert stay only there.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) |
| `options` | [`ConvertIntoNewColumnOptions`](../type-aliases/ConvertIntoNewColumnOptions.md) |

#### Returns

`Promise`\<[`DatabaseColumn`](../../column/classes/DatabaseColumn.md)\>

***

### createTable()

> **createTable**(`options`): `Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md)\>

Create a table in the database, under an id minted here.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `name`: `string`; \} |
| `options.name` | `string` |

#### Returns

`Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md)\>

***

### createWebhook()

> **createWebhook**(`table`): `Promise`\<\{ `token`: `string`; `webhook`: [`DatabaseWebhook`](../../webhook/classes/DatabaseWebhook.md); \}\>

Create a webhook that inserts rows into `table`, writing with the
caller's access. POST a JSON object (one row) or an array of objects to
`/databases/webhooks/{token}` on the storage service; keys name columns.
The token is the whole credential and is answered only here.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |

#### Returns

`Promise`\<\{ `token`: `string`; `webhook`: [`DatabaseWebhook`](../../webhook/classes/DatabaseWebhook.md); \}\>

***

### deleteColumn()

> **deleteColumn**(`column`): `Promise`\<`number`\>

Remove a column and its cells at the table version last read. Returns
the table's new version.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) |

#### Returns

`Promise`\<`number`\>

***

### deleteTable()

> **deleteTable**(`table`): `Promise`\<`void`\>

Delete one of the database's tables with its columns, rows, and views.
A database keeps at least one table, and a table another table's
relation column points at cannot be deleted.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |

#### Returns

`Promise`\<`void`\>

***

### deleteWebhook()

> **deleteWebhook**(`webhook`): `Promise`\<`void`\>

Delete one of the database's webhooks; its URL stops working.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `webhook` | [`DatabaseWebhook`](../../webhook/classes/DatabaseWebhook.md) |

#### Returns

`Promise`\<`void`\>

***

### importTable()

> **importTable**(`request`): `Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md)\>

Import text rows atomically. Keep requestId unchanged when retrying.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`ImportTable`](../../../../../generated/storage/types.gen/type-aliases/ImportTable.md) |

#### Returns

`Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md)\>

***

### inferColumnType()

> **inferColumnType**(`column`, `options`): `Promise`\<[`InferColumnTypeOutcome`](../../../../../generated/storage/types.gen/type-aliases/InferColumnTypeOutcome.md)\>

Adopt a first-value type only while the owned column is empty and inferable.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) |
| `options` | [`InferColumnTypeOptions`](../type-aliases/InferColumnTypeOptions.md) |

#### Returns

`Promise`\<[`InferColumnTypeOutcome`](../../../../../generated/storage/types.gen/type-aliases/InferColumnTypeOutcome.md)\>

***

### query()

> **query**(`sql`, `options?`): `Promise`\<[`DatabaseQueryResult`](../../query/interfaces/DatabaseQueryResult.md)\>

Run one SQL statement with this database as the default name scope.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sql` | `string` |
| `options?` | `Omit`\<[`DatabaseQueryOptions`](../../query/interfaces/DatabaseQueryOptions.md), `"database"`\> |

#### Returns

`Promise`\<[`DatabaseQueryResult`](../../query/interfaces/DatabaseQueryResult.md)\>

***

### renameColumn()

> **renameColumn**(`column`, `name`): `Promise`\<`number`\>

Rename this column placement, only if its last-read name is still
current, without changing its shared property definition. Returns the
table's new version.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `column` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md) |
| `name` | `string` |

#### Returns

`Promise`\<`number`\>

***

### renameTable()

> **renameTable**(`table`, `name`): `Promise`\<`number`\>

Rename a table only if its last-read name is still current. Returns the
table's new version.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |
| `name` | `string` |

#### Returns

`Promise`\<`number`\>

***

### reorderColumns()

> **reorderColumns**(`table`, `columns`): `Promise`\<`number`\>

Persist a complete column order at the table version last read. Pass
every column of the table exactly once.
Returns the table's new version.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |
| `columns` | [`DatabaseColumn`](../../column/classes/DatabaseColumn.md)[] |

#### Returns

`Promise`\<`number`\>

***

### reorderTables()

> **reorderTables**(`tables`): `Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md)[]\>

Persist a new tab order. Pass every table of the database exactly once.
Returns the tables in their new order.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tables` | [`DatabaseTable`](../../table/classes/DatabaseTable.md)[] |

#### Returns

`Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md)[]\>

***

### rowHistory()

> **rowHistory**(`row`): `Promise`\<[`RowHistoryEntry`](../../../../../generated/storage/types.gen/type-aliases/RowHistoryEntry.md)[]\>

A row's history: every committed change that touched it, newest first.
See [DatabaseRow.history](../../row/classes/DatabaseRow.md#history).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `row` | [`DatabaseRow`](../../row/classes/DatabaseRow.md) |

#### Returns

`Promise`\<[`RowHistoryEntry`](../../../../../generated/storage/types.gen/type-aliases/RowHistoryEntry.md)[]\>

***

### schema()

> **schema**(): `Promise`\<[`DatabaseDetail`](../../../../../generated/storage/types.gen/type-aliases/DatabaseDetail.md)\>

The full schema: the database record, the caller's access, and every
table with its columns and views. Cached until the next write.

#### Returns

`Promise`\<[`DatabaseDetail`](../../../../../generated/storage/types.gen/type-aliases/DatabaseDetail.md)\>

***

### sharePermissions()

> **sharePermissions**(): `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

Read direct recipients. Only the database owner can manage sharing.

#### Returns

`Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

***

### table()

> **table**(`name`): `Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md) \| `undefined`\>

The table with the given display name, or `undefined` if there is none.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<[`DatabaseTable`](../../table/classes/DatabaseTable.md) \| `undefined`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`DatabaseDetail`](../../../../../generated/storage/types.gen/type-aliases/DatabaseDetail.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`DatabaseDetail`](../../../../../generated/storage/types.gen/type-aliases/DatabaseDetail.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`DatabaseDetail`](../../../../../generated/storage/types.gen/type-aliases/DatabaseDetail.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### updateSharePermissions()

> **updateSharePermissions**(`request`): `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

Add, replace, or remove recipient grants without transferring ownership.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`UpdateSharePermissionRequestV2`](../../../../../generated/storage/types.gen/type-aliases/UpdateSharePermissionRequestV2.md) |

#### Returns

`Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

***

### viewPositions()

> **viewPositions**(`view`): `Promise`\<[`CardPosition`](../../../../../generated/storage/types.gen/type-aliases/CardPosition.md)[]\>

Where a board view's cards sit: each placed card's lane and key.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `view` | [`DatabaseView`](../../view/classes/DatabaseView.md) |

#### Returns

`Promise`\<[`CardPosition`](../../../../../generated/storage/types.gen/type-aliases/CardPosition.md)[]\>

***

### webhooks()

> **webhooks**(): `Promise`\<[`DatabaseWebhook`](../../webhook/classes/DatabaseWebhook.md)[]\>

The database's webhooks, oldest first. Takes edit access.

#### Returns

`Promise`\<[`DatabaseWebhook`](../../webhook/classes/DatabaseWebhook.md)[]\>

***

### byId()

> `static` **byId**(`client`, `id`): `Database`

A handle to a database by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Database`

***

### create()

> `static` **create**(`client`, `options`): `Promise`\<`Database`\>

Create a database owned by the caller.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `options` | \{ `name`: `string`; \} |
| `options.name` | `string` |

#### Returns

`Promise`\<`Database`\>

***

### list()

> `static` **list**(`client`): `Promise`\<`Database`[]\>

The databases the caller can see, each with the caller's access level.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`Database`[]\>
