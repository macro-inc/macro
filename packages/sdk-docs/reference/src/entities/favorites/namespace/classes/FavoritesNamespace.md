# Class: FavoritesNamespace

The user's favorites: a manually ordered collection of entity references.

## Constructors

### Constructor

> **new FavoritesNamespace**(`client`): `FavoritesNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`FavoritesNamespace`

## Methods

### add()

> **add**(`entity`): `Promise`\<[`Favorite`](../../../../../generated/storage/types.gen/type-aliases/Favorite.md)\>

Favorite an entity. Returns the favorite record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `entity` | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<`unknown`\> |

#### Returns

`Promise`\<[`Favorite`](../../../../../generated/storage/types.gen/type-aliases/Favorite.md)\>

***

### list()

> **list**(`filter?`): `Promise`\<[`Favorite`](../../../../../generated/storage/types.gen/type-aliases/Favorite.md)[]\>

The user's favorites, in manual order.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `filter?` | [`FavoritesFilter`](../type-aliases/FavoritesFilter.md) |

#### Returns

`Promise`\<[`Favorite`](../../../../../generated/storage/types.gen/type-aliases/Favorite.md)[]\>

***

### remove()

> **remove**(`entity`): `Promise`\<`void`\>

Remove an entity from the user's favorites.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `entity` | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<`unknown`\> |

#### Returns

`Promise`\<`void`\>

***

### reorder()

> **reorder**(`favorites`): `Promise`\<`void`\>

Reorder the favorites: pass every favorited entity in the desired order.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `favorites` | [`FavoriteEntityRef`](../../../../../generated/storage/types.gen/type-aliases/FavoriteEntityRef.md)[] |

#### Returns

`Promise`\<`void`\>
