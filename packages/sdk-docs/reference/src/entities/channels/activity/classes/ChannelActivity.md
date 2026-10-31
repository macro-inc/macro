# Class: ChannelActivity

A user's channel activity marker.

## Constructors

### Constructor

> **new ChannelActivity**(`client`, `channel`, `record`): `ChannelActivity`

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `client` | `MacroClient` | - |
| `channel` | [`Channel`](../../channel/classes/Channel.md) | Related channel. |
| `record` | [`ApiActivity`](../../../../../generated/storage/types.gen/type-aliases/ApiActivity.md) | - |

#### Returns

`ChannelActivity`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-channel"></a> `channel` | `readonly` | [`Channel`](../../channel/classes/Channel.md) | Related channel. |

## Accessors

### id

#### Get Signature

> **get** **id**(): `string`

Activity identity.

##### Returns

`string`

## Methods

### createdAt()

> **createdAt**(): `string`

Creation time.

#### Returns

`string`

***

### recordInteraction()

> **recordInteraction**(`type`): `Promise`\<`ChannelActivity`\>

Record a view or interaction in this channel.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `type` | [`ActivityType`](../../../../../generated/storage/types.gen/type-aliases/ActivityType.md) |

#### Returns

`Promise`\<`ChannelActivity`\>

***

### toJSON()

> **toJSON**(): [`ApiActivity`](../../../../../generated/storage/types.gen/type-aliases/ApiActivity.md)

Serialize activity without credentials.

#### Returns

[`ApiActivity`](../../../../../generated/storage/types.gen/type-aliases/ApiActivity.md)

***

### user()

> **user**(): [`User`](../../../users/user/classes/User.md)

User who interacted.

#### Returns

[`User`](../../../users/user/classes/User.md)
