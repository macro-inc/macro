# Class: PipelineColumn

A column belonging to a pipeline table.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ColumnDetail`](../../../../../generated/storage/types.gen/type-aliases/ColumnDetail.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-table"></a> `table` | `readonly` | [`PipelineTable`](PipelineTable.md) | Parent table. | - |

## Methods

### name()

> **name**(): `Promise`\<`string`\>

Current column label.

#### Returns

`Promise`\<`string`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ColumnDetail`](../../../../../generated/storage/types.gen/type-aliases/ColumnDetail.md); `id`: `string`; `pipelineId`: `string`; `tableId`: `string`; \}

Serialize identity within its pipeline.

#### Returns

\{ `detail?`: [`ColumnDetail`](../../../../../generated/storage/types.gen/type-aliases/ColumnDetail.md); `id`: `string`; `pipelineId`: `string`; `tableId`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ColumnDetail`](../../../../../generated/storage/types.gen/type-aliases/ColumnDetail.md) |
| `id` | `string` |
| `pipelineId` | `string` |
| `tableId` | `string` |

#### Overrides

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### writable()

> **writable**(): `Promise`\<`boolean`\>

Whether the caller can write this column.

#### Returns

`Promise`\<`boolean`\>

***

### from()

> `static` **from**(`client`, `table`, `record`): `PipelineColumn`

Seed a column handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `table` | [`PipelineTable`](PipelineTable.md) |
| `record` | [`ColumnDetail`](../../../../../generated/storage/types.gen/type-aliases/ColumnDetail.md) |

#### Returns

`PipelineColumn`
