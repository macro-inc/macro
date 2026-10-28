# Class: EntityMentionNamespace

Stored entity mention relationships.

## Constructors

### Constructor

> **new EntityMentionNamespace**(`client`): `EntityMentionNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`EntityMentionNamespace`

## Methods

### byId()

> **byId**(`id`): [`EntityMention`](../../mention/classes/EntityMention.md)

Construct a stored mention handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`EntityMention`](../../mention/classes/EntityMention.md)

***

### create()

> **create**(`source`, `target`): `Promise`\<[`EntityMention`](../../mention/classes/EntityMention.md)\>

Create a mention from a source resource to a target resource.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `source` | [`EntityReference`](../../../reference/type-aliases/EntityReference.md) |
| `target` | [`EntityReference`](../../../reference/type-aliases/EntityReference.md) |

#### Returns

`Promise`\<[`EntityMention`](../../mention/classes/EntityMention.md)\>
