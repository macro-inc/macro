# Class: SavedView

A saved view: a named, reusable filter definition (not a snapshot of what
it matches) shown in the app's sidebar for its kind, such as Email.

Writes are guarded by the revision this handle last saw, so a stale handle
fails with a conflict (MacroApiError with status 409) instead of
overwriting an edit made elsewhere; reload it with [refresh](#refresh) and retry.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`SavedViewDefinition`](../../../../../generated/storage/types.gen/type-aliases/SavedViewDefinition.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-config"></a> `config` | `readonly` | () => `Promise`\<[`SavedViewConfig`](../type-aliases/SavedViewConfig.md)\> | The configuration, interpreted by the app surface of its `kind`. | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the view was created. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-kind"></a> `kind` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The app surface that shows this view, such as `email` or `task`. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | The display name. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The user who owns and can edit this view. | - |
| <a id="property-revision"></a> `revision` | `readonly` | () => `Promise`\<`number`\> | The revision writes are checked against; each successful write advances it. | - |
| <a id="property-team"></a> `team` | `readonly` | () => `Promise`\<[`Team`](../../../teams/team/classes/Team.md) \| `undefined`\> | The team the view is shared with, or `undefined` when it is private. | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | When the view was last changed. | - |

## Methods

### edit()

> **edit**(`changes`): `Promise`\<`void`\>

Change the name, replace the configuration, or change sharing: a `team`
shares the view with it and `null` makes it private; omitted fields are
kept. Only the owner can edit.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `changes` | \{ `config?`: [`SavedViewConfig`](../type-aliases/SavedViewConfig.md); `name?`: `string`; `team?`: [`Team`](../../../teams/team/classes/Team.md) \| `null`; \} |
| `changes.config?` | [`SavedViewConfig`](../type-aliases/SavedViewConfig.md) |
| `changes.name?` | `string` |
| `changes.team?` | [`Team`](../../../teams/team/classes/Team.md) \| `null` |

#### Returns

`Promise`\<`void`\>

***

### refresh()

> **refresh**(): `Promise`\<`SavedView`\>

Reload the view, picking up its current revision.

#### Returns

`Promise`\<`SavedView`\>

***

### remove()

> **remove**(): `Promise`\<`void`\>

Delete the view for its owner and anyone it is shared with. Only the owner can delete.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`SavedViewDefinition`](../../../../../generated/storage/types.gen/type-aliases/SavedViewDefinition.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`SavedViewDefinition`](../../../../../generated/storage/types.gen/type-aliases/SavedViewDefinition.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`SavedViewDefinition`](../../../../../generated/storage/types.gen/type-aliases/SavedViewDefinition.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`): `SavedView`

A handle to a saved view by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`SavedView`

***

### create()

> `static` **create**(`client`, `opts`): `Promise`\<`SavedView`\>

Create a saved view, private unless shared with a team the caller belongs to.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | \{ `config`: [`SavedViewConfig`](../type-aliases/SavedViewConfig.md); `name`: `string`; `team?`: [`Team`](../../../teams/team/classes/Team.md); \} |
| `opts.config` | [`SavedViewConfig`](../type-aliases/SavedViewConfig.md) |
| `opts.name` | `string` |
| `opts.team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<`SavedView`\>

***

### fromRecord()

> `static` **fromRecord**(`client`, `record`): `SavedView`

Wrap an already-loaded record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`SavedViewDefinition`](../../../../../generated/storage/types.gen/type-aliases/SavedViewDefinition.md) |

#### Returns

`SavedView`
