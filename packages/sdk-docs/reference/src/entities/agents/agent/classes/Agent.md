# Class: Agent

A configurable agent backed by a bot identity.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Agent`](../../../../../generated/storage/types.gen/type-aliases/Agent.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-channels"></a> `channels` | `readonly` | () => `Promise`\<[`Channel`](../../../channels/channel/classes/Channel.md)[]\> | Visible channels. | - |
| <a id="property-defaultmodel"></a> `defaultModel` | `readonly` | () => `Promise`\<`string`\> | Default model. | - |
| <a id="property-host"></a> `host` | `readonly` | () => `Promise`\<[`Harness`](../../../harnesses/harness/classes/Harness.md) \| `undefined`\> | Host running this agent. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-instructions"></a> `instructions` | `readonly` | () => `Promise`\<`string`\> | Agent instructions. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Display name. | - |

## Methods

### toJSON()

> **toJSON**(): \{ `detail?`: [`Agent`](../../../../../generated/storage/types.gen/type-aliases/Agent.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Agent`](../../../../../generated/storage/types.gen/type-aliases/Agent.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Agent`](../../../../../generated/storage/types.gen/type-aliases/Agent.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`options`): `Promise`\<`void`\>

Replace agent settings.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`AgentOptions`](../type-aliases/AgentOptions.md) |

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `id`): `Agent`

Construct a lazy agent handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Agent`

***

### from()

> `static` **from**(`client`, `record`): `Agent`

Seed from a listed or created agent.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`Agent`](../../../../../generated/storage/types.gen/type-aliases/Agent.md) |

#### Returns

`Agent`
