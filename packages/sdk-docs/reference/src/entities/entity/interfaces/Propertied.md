# Interface: Propertied

A favoritable entity that also carries user-defined properties.

## Extends

- [`Favoritable`](Favoritable.md)

## Methods

### deleteProperty()

> **deleteProperty**(`assignment`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `assignment` | [`EntityPropertyWithDefinition`](../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md) |

#### Returns

`Promise`\<`void`\>

***

### favorite()

> **favorite**(): `Promise`\<`Propertied`\>

#### Returns

`Promise`\<`Propertied`\>

#### Inherited from

[`Favoritable`](Favoritable.md).[`favorite`](Favoritable.md#favorite)

***

### properties()

> **properties**(`opts?`): `Promise`\<[`EntityPropertyWithDefinition`](../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md)[]\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `includeMetadata?`: `boolean`; \} |
| `opts.includeMetadata?` | `boolean` |

#### Returns

`Promise`\<[`EntityPropertyWithDefinition`](../../../../generated/properties/types.gen/type-aliases/EntityPropertyWithDefinition.md)[]\>

***

### setProperty()

> **setProperty**(`property`, `value?`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `property` | [`PropertyDefinition`](../../properties/property-definition/classes/PropertyDefinition.md) |
| `value?` | [`SetPropertyValue`](../../../../generated/properties/types.gen/type-aliases/SetPropertyValue.md) |

#### Returns

`Promise`\<`void`\>

***

### unfavorite()

> **unfavorite**(): `Promise`\<`Propertied`\>

#### Returns

`Promise`\<`Propertied`\>

#### Inherited from

[`Favoritable`](Favoritable.md).[`unfavorite`](Favoritable.md#unfavorite)
