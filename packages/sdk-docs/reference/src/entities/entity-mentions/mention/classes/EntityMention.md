# Class: EntityMention

A stored mention connecting two resources.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` | Mention identity. |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Remove this mention.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `id`: `string`; \}

Serialize identity only.

#### Returns

\{ `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `id` | `string` |

***

### byId()

> `static` **byId**(`client`, `id`): `EntityMention`

Construct a mention handle for removal.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`EntityMention`
