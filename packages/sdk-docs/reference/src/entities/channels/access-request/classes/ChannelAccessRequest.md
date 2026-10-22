# Class: ChannelAccessRequest

One attempt to join a private or team channel. Any participant of the
channel can read and answer it; approving adds the requester as a member.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ChannelAccessRequest`](../../../../../generated/storage/types.gen/type-aliases/ChannelAccessRequest.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-channel"></a> `channel` | `readonly` | [`Channel`](../../channel/classes/Channel.md) | Channel the requester asked to join. | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the requester asked. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-requester"></a> `requester` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | The person asking to join. | - |
| <a id="property-resolvedat"></a> `resolvedAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | When the request stopped being pending. | - |
| <a id="property-resolvedby"></a> `resolvedBy` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md) \| `undefined`\> | The participant who approved or denied the request. | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<[`ChannelAccessRequestStatus`](../../../../../generated/storage/types.gen/type-aliases/ChannelAccessRequestStatus.md)\> | Pending, approved, denied, or cancelled by the requester. | - |

## Methods

### approve()

> **approve**(): `Promise`\<`void`\>

Add the requester to the channel. Fails if someone answered first.

#### Returns

`Promise`\<`void`\>

***

### deny()

> **deny**(): `Promise`\<`void`\>

Decline the request; the requester can ask again after a day.

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ChannelAccessRequest`](../../../../../generated/storage/types.gen/type-aliases/ChannelAccessRequest.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ChannelAccessRequest`](../../../../../generated/storage/types.gen/type-aliases/ChannelAccessRequest.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ChannelAccessRequest`](../../../../../generated/storage/types.gen/type-aliases/ChannelAccessRequest.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `channel`, `id`): `ChannelAccessRequest`

A request to join `channel`, loaded lazily for its participants.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `channel` | [`Channel`](../../channel/classes/Channel.md) |
| `id` | `string` |

#### Returns

`ChannelAccessRequest`

***

### from()

> `static` **from**(`client`, `channel`, `record`): `ChannelAccessRequest`

Seed a request from a response that already carries it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `channel` | [`Channel`](../../channel/classes/Channel.md) |
| `record` | [`ChannelAccessRequest`](../../../../../generated/storage/types.gen/type-aliases/ChannelAccessRequest.md) |

#### Returns

`ChannelAccessRequest`
