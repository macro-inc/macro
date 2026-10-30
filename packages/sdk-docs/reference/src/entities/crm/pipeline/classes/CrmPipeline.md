# Class: CrmPipeline

A CRM pipeline with its own sharing boundary and backing table.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`AccessiblePipeline`](../../../../../generated/storage/types.gen/type-aliases/AccessiblePipeline.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-accesslevel"></a> `accessLevel` | `readonly` | () => `Promise`\<[`AccessLevel`](../../../../../generated/storage/types.gen/type-aliases/AccessLevel.md)\> | Current caller's access level. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Display name. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | Owner. | - |
| <a id="property-recordtype"></a> `recordType` | `readonly` | () => `Promise`\<[`PipelineRecordType`](../../../../../generated/storage/types.gen/type-aliases/PipelineRecordType.md)\> | CRM record type. | - |
| <a id="property-sharing"></a> `sharing` | `readonly` | () => `Promise`\<[`PipelineSharing`](../../../../../generated/storage/types.gen/type-aliases/PipelineSharing.md)\> | Sharing scope. | - |
| <a id="property-team"></a> `team` | `readonly` | () => `Promise`\<[`Team`](../../../teams/team/classes/Team.md)\> | Owning team. | - |

## Methods

### applyOps()

> **applyOps**(`ops`, `options?`): `Promise`\<[`AppliedOps`](../../../../../generated/storage/types.gen/type-aliases/AppliedOps.md)\>

Apply an atomic generated database operation batch through this pipeline.
As with Database.applyOps, batch-local UUIDs may name resources minted earlier in the batch.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ops` | [`DatabaseOp`](../../../../../generated/storage/types.gen/type-aliases/DatabaseOp.md)[] |
| `options?` | \{ `baseVersions?`: \{ `table`: [`PipelineTable`](PipelineTable.md); `version`: `number`; \}[]; \} |
| `options.baseVersions?` | \{ `table`: [`PipelineTable`](PipelineTable.md); `version`: `number`; \}[] |

#### Returns

`Promise`\<[`AppliedOps`](../../../../../generated/storage/types.gen/type-aliases/AppliedOps.md)\>

***

### queryRows()

> **queryRows**(`options?`): `AsyncGenerator`\<[`PipelineRow`](PipelineRow.md)\>

Query pipeline rows, optionally restricting the query to typed row handles.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `query?`: [`ViewQuery`](../../../../../generated/storage/types.gen/type-aliases/ViewQuery.md); `rows?`: [`PipelineRow`](PipelineRow.md)[]; \} |
| `options.query?` | [`ViewQuery`](../../../../../generated/storage/types.gen/type-aliases/ViewQuery.md) |
| `options.rows?` | [`PipelineRow`](PipelineRow.md)[] |

#### Returns

`AsyncGenerator`\<[`PipelineRow`](PipelineRow.md)\>

***

### rename()

> **rename**(`name`): `Promise`\<`void`\>

Rename this pipeline.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### rows()

> **rows**(): `AsyncGenerator`\<[`PipelineRow`](PipelineRow.md)\>

Rows in pipeline order, automatically paginated.

#### Returns

`AsyncGenerator`\<[`PipelineRow`](PipelineRow.md)\>

***

### setSharing()

> **setSharing**(`sharing`): `Promise`\<`void`\>

Change its sharing scope.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sharing` | [`PipelineSharing`](../../../../../generated/storage/types.gen/type-aliases/PipelineSharing.md) \| `undefined` |

#### Returns

`Promise`\<`void`\>

***

### setTrashed()

> **setTrashed**(`trashed`): `Promise`\<`void`\>

Trash or restore the pipeline.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `trashed` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### sharePermissions()

> **sharePermissions**(): `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

Read sharing grants.

#### Returns

`Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

***

### table()

> **table**(): `Promise`\<[`PipelineTable`](PipelineTable.md)\>

Read the backing table through the pipeline's authorization boundary.

#### Returns

`Promise`\<[`PipelineTable`](PipelineTable.md)\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`AccessiblePipeline`](../../../../../generated/storage/types.gen/type-aliases/AccessiblePipeline.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`AccessiblePipeline`](../../../../../generated/storage/types.gen/type-aliases/AccessiblePipeline.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`AccessiblePipeline`](../../../../../generated/storage/types.gen/type-aliases/AccessiblePipeline.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### updateSharePermissions()

> **updateSharePermissions**(`options`): `Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

Update sharing grants.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`SharePermissionOptions`](../../../sharing/permissions/type-aliases/SharePermissionOptions.md) |

#### Returns

`Promise`\<[`SharePermissionV2`](../../../../../generated/storage/types.gen/type-aliases/SharePermissionV2.md)\>

***

### byId()

> `static` **byId**(`client`, `id`): `CrmPipeline`

Construct a lazy pipeline handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`CrmPipeline`

***

### from()

> `static` **from**(`client`, `record`): `CrmPipeline`

Seed from a server record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`AccessiblePipeline`](../../../../../generated/storage/types.gen/type-aliases/AccessiblePipeline.md) |

#### Returns

`CrmPipeline`
