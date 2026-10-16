# Class: ChannelNamespace

## Constructors

### Constructor

> **new ChannelNamespace**(`client`): `ChannelNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ChannelNamespace`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-labels"></a> `labels` | `readonly` | [`ChannelLabelsNamespace`](../../labels/classes/ChannelLabelsNamespace.md) | Team-shared labels that group channels in the Chat sidebar. |

## Methods

### byId()

> **byId**(`id`): [`Channel`](../../channel/classes/Channel.md)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Channel`](../../channel/classes/Channel.md)

***

### create()

> **create**(`opts`): `Promise`\<[`Channel`](../../channel/classes/Channel.md)\>

Create a channel. The caller becomes the owner.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `opts` | \{ `name?`: `string`; `participants?`: [`User`](../../../users/user/classes/User.md)[]; `team?`: [`Team`](../../../teams/team/classes/Team.md); `type`: [`ChannelType`](../../../../../generated/storage/types.gen/type-aliases/ChannelType.md); \} | - |
| `opts.name?` | `string` | - |
| `opts.participants?` | [`User`](../../../users/user/classes/User.md)[] | Participants to add, excluding the owner. |
| `opts.team?` | [`Team`](../../../teams/team/classes/Team.md) | Team, for team channels. |
| `opts.type` | [`ChannelType`](../../../../../generated/storage/types.gen/type-aliases/ChannelType.md) | - |

#### Returns

`Promise`\<[`Channel`](../../channel/classes/Channel.md)\>

***

### dm()

> **dm**(`recipient`): `Promise`\<[`Channel`](../../channel/classes/Channel.md)\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `recipient` | [`User`](../../../users/user/classes/User.md) |

#### Returns

`Promise`\<[`Channel`](../../channel/classes/Channel.md)\>

***

### list()

> **list**(): `Promise`\<[`Channel`](../../channel/classes/Channel.md)[]\>

All channels the authenticated user is a member of.

#### Returns

`Promise`\<[`Channel`](../../channel/classes/Channel.md)[]\>

***

### private()

> **private**(`recipients`): `Promise`\<[`Channel`](../../channel/classes/Channel.md)\>

Open (creating if needed) the private group channel with a set of users.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `recipients` | [`User`](../../../users/user/classes/User.md)[] |

#### Returns

`Promise`\<[`Channel`](../../channel/classes/Channel.md)\>

***

### search()

> **search**(`query`, `opts?`): `AsyncGenerator`\<[`Channel`](../../channel/classes/Channel.md)\>

Search channels by name (client-side fuzzy filter on the full channel list)
or by content (server-side unified search).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |
| `opts?` | [`SearchOpts`](../../../search/interfaces/SearchOpts.md) |

#### Returns

`AsyncGenerator`\<[`Channel`](../../channel/classes/Channel.md)\>
