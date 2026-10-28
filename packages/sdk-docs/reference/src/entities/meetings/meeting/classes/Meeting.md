# Class: Meeting

A meeting's schedule and invitation link.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`Meeting`](../../../../../generated/storage/types.gen/type-aliases/Meeting.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-call"></a> `call` | `readonly` | () => `Promise`\<[`CallRecord`](../../../calls/call-record/classes/CallRecord.md) \| `undefined`\> | Associated call record. | - |
| <a id="property-channel"></a> `channel` | `readonly` | () => `Promise`\<[`Channel`](../../../channels/channel/classes/Channel.md) \| `undefined`\> | Associated channel. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-scheduledend"></a> `scheduledEnd` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Scheduled end. | - |
| <a id="property-scheduledstart"></a> `scheduledStart` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Scheduled start. | - |
| <a id="property-title"></a> `title` | `readonly` | () => `Promise`\<`string`\> | Display title. | - |

## Methods

### cancel()

> **cancel**(): `Promise`\<`void`\>

Cancel this meeting.

#### Returns

`Promise`\<`void`\>

***

### invite()

> **invite**(`email`): `Promise`\<`void`\>

Invite an email address.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `email` | `string` |

#### Returns

`Promise`\<`void`\>

***

### invitePermissions()

> **invitePermissions**(): `Promise`\<[`MeetingInvitePermissions`](../../../../../generated/storage/types.gen/type-aliases/MeetingInvitePermissions.md)\>

Whether the caller can send invitations.

#### Returns

`Promise`\<[`MeetingInvitePermissions`](../../../../../generated/storage/types.gen/type-aliases/MeetingInvitePermissions.md)\>

***

### inviteUsers()

> **inviteUsers**(`users`): `Promise`\<`void`\>

Invite Macro users.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `users` | [`User`](../../../users/user/classes/User.md)[] |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`Meeting`](../../../../../generated/storage/types.gen/type-aliases/Meeting.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`Meeting`](../../../../../generated/storage/types.gen/type-aliases/Meeting.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`Meeting`](../../../../../generated/storage/types.gen/type-aliases/Meeting.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`options`): `Promise`\<`void`\>

Update schedule or title.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`UpdateMeetingRequest`](../../../../../generated/storage/types.gen/type-aliases/UpdateMeetingRequest.md) |

#### Returns

`Promise`\<`void`\>

***

### webUrl()

> **webUrl**(): `Promise`\<`string`\>

Shareable meeting link.

#### Returns

`Promise`\<`string`\>

***

### byId()

> `static` **byId**(`client`, `id`): `Meeting`

Construct a lazy meeting handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Meeting`

***

### from()

> `static` **from**(`client`, `record`): `Meeting`

Seed a meeting from a server response.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`Meeting`](../../../../../generated/storage/types.gen/type-aliases/Meeting.md) |

#### Returns

`Meeting`
