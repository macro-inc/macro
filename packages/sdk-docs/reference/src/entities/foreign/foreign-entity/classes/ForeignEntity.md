# Class: ForeignEntity

A read-only mapping to an entity owned by an external system (e.g. a
GitHub pull request). Keyed by the internal foreign-entity record id.

## Extends

- [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md)\<`ForeignEntityDetail`\>

## Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the record was created (ISO timestamp). | - | - |
| <a id="property-entitytype"></a> `entityType` | `readonly` | `"foreign_entity"` | `'foreign_entity'` | Favorites identify foreign entities as `foreign_entity`. | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`entityType`](../../../entity/classes/FavoritableEntity.md#property-entitytype) | - |
| <a id="property-foreignentityid"></a> `foreignEntityId` | `readonly` | () => `Promise`\<`string`\> | `...` | The identifier assigned by the external system. | - | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | `undefined` | - | - | [`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`id`](../../../entity/classes/FavoritableEntity.md#property-id) |
| <a id="property-source"></a> `source` | `readonly` | () => `Promise`\<`string`\> | `...` | The source system that owns the external identifier (e.g. `github_pull_request`). | - | - |
| <a id="property-storedforauthentity"></a> `storedForAuthEntity` | `readonly` | () => `Promise`\<`string`\> | `...` | The internal auth entity namespace this foreign entity is stored for. | - | - |
| <a id="property-storedforid"></a> `storedForId` | `readonly` | () => `Promise`\<`string`\> | `...` | The internal entity id this foreign entity is stored for. | - | - |
| <a id="property-updatedat"></a> `updatedAt` | `readonly` | () => `Promise`\<`string`\> | `...` | When the record was last updated (ISO timestamp). | - | - |

## Methods

### favorite()

> **favorite**(): `Promise`\<`ForeignEntity`\>

Add this entity to the user's favorites. Returns this handle for chaining.
Plain unwrap: favoriting alters the user's favorites collection, not this
entity's own detail, so there's nothing cached to invalidate.

#### Returns

`Promise`\<`ForeignEntity`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`favorite`](../../../entity/classes/FavoritableEntity.md#favorite)

***

### metadata()

> **metadata**(): `Promise`\<`unknown`\>

Arbitrary source-specific metadata stored with the mapping.

#### Returns

`Promise`\<`unknown`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ForeignEntity`](../../../../../generated/storage/types.gen/type-aliases/ForeignEntity.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ForeignEntity`](../../../../../generated/storage/types.gen/type-aliases/ForeignEntity.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ForeignEntity`](../../../../../generated/storage/types.gen/type-aliases/ForeignEntity.md) |
| `id` | `string` |

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`toJSON`](../../../entity/classes/FavoritableEntity.md#tojson)

***

### unfavorite()

> **unfavorite**(): `Promise`\<`ForeignEntity`\>

Remove this entity from the user's favorites. Returns this handle for chaining.

#### Returns

`Promise`\<`ForeignEntity`\>

#### Inherited from

[`FavoritableEntity`](../../../entity/classes/FavoritableEntity.md).[`unfavorite`](../../../entity/classes/FavoritableEntity.md#unfavorite)

***

### byId()

> `static` **byId**(`client`, `id`): `ForeignEntity`

A handle to a foreign entity by its internal record id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`ForeignEntity`

***

### fromRecord()

> `static` **fromRecord**(`client`, `record`): `ForeignEntity`

Build a foreign entity from an already-fetched record (pre-seeded, no fetch).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`ForeignEntity`](../../../../../generated/storage/types.gen/type-aliases/ForeignEntity.md) |

#### Returns

`ForeignEntity`
