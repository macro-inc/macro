# Class: PipelineNamespace

CRM pipelines in the caller's team.

## Constructors

### Constructor

> **new PipelineNamespace**(`client`): `PipelineNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`PipelineNamespace`

## Methods

### byId()

> **byId**(`id`): [`CrmPipeline`](../../pipeline/classes/CrmPipeline.md)

Construct a lazy pipeline handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`CrmPipeline`](../../pipeline/classes/CrmPipeline.md)

***

### create()

> **create**(`options`): `Promise`\<[`CrmPipeline`](../../pipeline/classes/CrmPipeline.md)\>

Create a pipeline and its backing storage.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`CreatePipeline`](../../../../../generated/storage/types.gen/type-aliases/CreatePipeline.md) |

#### Returns

`Promise`\<[`CrmPipeline`](../../pipeline/classes/CrmPipeline.md)\>

***

### list()

> **list**(): `Promise`\<[`CrmPipeline`](../../pipeline/classes/CrmPipeline.md)[]\>

List accessible pipelines.

#### Returns

`Promise`\<[`CrmPipeline`](../../pipeline/classes/CrmPipeline.md)[]\>
