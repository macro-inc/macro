# Class: PipelineTable

Backing table of a CRM pipeline.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`TableDetail`](../../../../../generated/storage/types.gen/type-aliases/TableDetail.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-pipeline"></a> `pipeline` | `readonly` | [`CrmPipeline`](CrmPipeline.md) | Parent pipeline. | - |

## Methods

### columns()

> **columns**(): `Promise`\<[`PipelineColumn`](PipelineColumn.md)[]\>

Columns in this table.

#### Returns

`Promise`\<[`PipelineColumn`](PipelineColumn.md)[]\>

***

### rowById()

> **rowById**(`id`): [`PipelineRow`](PipelineRow.md)

A scoped row handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`PipelineRow`](PipelineRow.md)

***

### rows()

> **rows**(): `AsyncGenerator`\<[`PipelineRow`](PipelineRow.md)\>

Rows from the authorized pipeline surface.

#### Returns

`AsyncGenerator`\<[`PipelineRow`](PipelineRow.md)\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`TableDetail`](../../../../../generated/storage/types.gen/type-aliases/TableDetail.md); `id`: `string`; `pipelineId`: `string`; \}

Serialize identity within its pipeline.

#### Returns

\{ `detail?`: [`TableDetail`](../../../../../generated/storage/types.gen/type-aliases/TableDetail.md); `id`: `string`; `pipelineId`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`TableDetail`](../../../../../generated/storage/types.gen/type-aliases/TableDetail.md) |
| `id` | `string` |
| `pipelineId` | `string` |

#### Overrides

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### version()

> **version**(): `Promise`\<`number`\>

Table version for optimistic operation batches.

#### Returns

`Promise`\<`number`\>

***

### from()

> `static` **from**(`client`, `pipeline`, `record`): `PipelineTable`

Seed a table from a pipeline table response.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `pipeline` | [`CrmPipeline`](CrmPipeline.md) |
| `record` | [`TableDetail`](../../../../../generated/storage/types.gen/type-aliases/TableDetail.md) |

#### Returns

`PipelineTable`
