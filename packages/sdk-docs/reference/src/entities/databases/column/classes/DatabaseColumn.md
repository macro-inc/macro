# Class: DatabaseColumn

One column of a [DatabaseTable](../../table/classes/DatabaseTable.md): the placement of a property
definition on the table.

A column is not an entity of its own — it has no permissions and no
endpoint to read it directly. The handle resolves through the owning
database's schema, so a fresh read after a write sees the new value.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` | Identifier of the column placement. |
| <a id="property-table"></a> `table` | `readonly` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) | The table this column belongs to. |

## Methods

### addOptions()

> **addOptions**(`labels`): `Promise`\<`DatabaseColumn`\>

Add select options to the column. Labels it already has are skipped, so
the call is safe to repeat. Only select and tag columns accept options.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `labels` | `string`[] |

#### Returns

`Promise`\<`DatabaseColumn`\>

***

### casts()

> **casts**(): `Promise`\<[`ColumnCast`](../../../../../generated/storage/types.gen/type-aliases/ColumnCast.md)[]\>

What changing this column to each type would do to its values: `safe`,
`checked` (with how many would not convert, and a few of them), or
`never` (with why). Changes nothing.

#### Returns

`Promise`\<[`ColumnCast`](../../../../../generated/storage/types.gen/type-aliases/ColumnCast.md)[]\>

***

### changeType()

> **changeType**(`options`): `Promise`\<[`OpResultOf`](../../database/type-aliases/OpResultOf.md)\<`"column"`, `"type_changed"`\>\>

Change this column's type. See Database.changeColumnType.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`ChangeColumnTypeOptions`](../../database/type-aliases/ChangeColumnTypeOptions.md) |

#### Returns

`Promise`\<[`OpResultOf`](../../database/type-aliases/OpResultOf.md)\<`"column"`, `"type_changed"`\>\>

***

### config()

> **config**(): `Promise`\<[`ColumnConfig`](../../../../../generated/storage/types.gen/type-aliases/ColumnConfig.md) \| `undefined`\>

Column-kind configuration (a link), or `undefined` for a plain
value column.

#### Returns

`Promise`\<[`ColumnConfig`](../../../../../generated/storage/types.gen/type-aliases/ColumnConfig.md) \| `undefined`\>

***

### convertIntoNewColumn()

> **convertIntoNewColumn**(`options`): `Promise`\<`DatabaseColumn`\>

Add a column of another type right after this one, filled with the
values that convert, leaving this one as it is. See
Database.convertColumnIntoNewColumn.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`ConvertIntoNewColumnOptions`](../../database/type-aliases/ConvertIntoNewColumnOptions.md) |

#### Returns

`Promise`\<`DatabaseColumn`\>

***

### dataType()

> **dataType**(): `Promise`\<[`DataType`](../../../../../generated/storage/types.gen/type-aliases/DataType.md)\>

The value type the column holds.

#### Returns

`Promise`\<[`DataType`](../../../../../generated/storage/types.gen/type-aliases/DataType.md)\>

***

### definition()

> **definition**(): `Promise`\<[`PropertyDefinitionWithOptions`](../../../../../generated/storage/types.gen/type-aliases/PropertyDefinitionWithOptions.md)\>

The bound property definition together with its select options — the
source of the column's name, type, and allowed values.

#### Returns

`Promise`\<[`PropertyDefinitionWithOptions`](../../../../../generated/storage/types.gen/type-aliases/PropertyDefinitionWithOptions.md)\>

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this placement and its cells at the table version last read.

#### Returns

`Promise`\<`void`\>

***

### detail()

> **detail**(): `Promise`\<[`ColumnDetail`](../../../../../generated/storage/types.gen/type-aliases/ColumnDetail.md)\>

The column's record as the API returns it: the placement and the bound
property definition.

#### Returns

`Promise`\<[`ColumnDetail`](../../../../../generated/storage/types.gen/type-aliases/ColumnDetail.md)\>

***

### inferType()

> **inferType**(`options`): `Promise`\<`DatabaseColumn`\>

Settle the type of an empty column created with inferType enabled.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`InferColumnTypeOptions`](../../database/type-aliases/InferColumnTypeOptions.md) |

#### Returns

`Promise`\<`DatabaseColumn`\>

***

### isMultiSelect()

> **isMultiSelect**(): `Promise`\<`boolean`\>

Whether the column holds multiple values.

#### Returns

`Promise`\<`boolean`\>

***

### name()

> **name**(): `Promise`\<`string`\>

The placement's display name, falling back to its property definition.

#### Returns

`Promise`\<`string`\>

***

### position()

> **position**(): `Promise`\<`string`\>

The column's fractional index within the table's column order.

#### Returns

`Promise`\<`string`\>

***

### rename()

> **rename**(`name`): `Promise`\<`DatabaseColumn`\>

Rename this placement, only if its last-read name is still current,
without changing its shared property definition.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`DatabaseColumn`\>

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

> `static` **byId**(`table`, `id`): `DatabaseColumn`

A handle to a column by id, within a table. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `table` | [`DatabaseTable`](../../table/classes/DatabaseTable.md) |
| `id` | `string` |

#### Returns

`DatabaseColumn`
