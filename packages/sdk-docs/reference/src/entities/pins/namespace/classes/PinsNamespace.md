# Class: PinsNamespace

The user's pins: items pinned to fixed slots in the home view.

## Constructors

### Constructor

> **new PinsNamespace**(`client`): `PinsNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`PinsNamespace`

## Methods

### add()

> **add**(`entity`, `opts`): `Promise`\<`void`\>

Pin an entity to a slot. `index` is the slot to put it in.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `entity` | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<`unknown`\> |
| `opts` | \{ `index`: `number`; \} |
| `opts.index` | `number` |

#### Returns

`Promise`\<`void`\>

***

### list()

> **list**(): `Promise`\<[`PinnedItem`](../../../../../generated/storage/types.gen/type-aliases/PinnedItem.md)[]\>

The user's pinned items, with their pin indices.

#### Returns

`Promise`\<[`PinnedItem`](../../../../../generated/storage/types.gen/type-aliases/PinnedItem.md)[]\>

***

### remove()

> **remove**(`entity`): `Promise`\<`void`\>

Unpin an entity.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `entity` | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<`unknown`\> |

#### Returns

`Promise`\<`void`\>

***

### reorder()

> **reorder**(`pins`): `Promise`\<`void`\>

Reorder pins: pass each pinned item with its type and new index.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `pins` | [`ReorderPinRequest`](../../../../../generated/storage/types.gen/type-aliases/ReorderPinRequest.md)[] |

#### Returns

`Promise`\<`void`\>
