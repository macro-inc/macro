# Class: ExternalChatParticipant

Someone in an added external chat, from its members; mention them in a text reply.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-chat"></a> `chat` | `readonly` | [`ExternalChat`](../../chat/classes/ExternalChat.md) | The chat whose members list them. |
| <a id="property-id"></a> `id` | `readonly` | `string` | Their provider id (a WhatsApp JID): correlation data, not a Macro user. |

## Accessors

### admin

#### Get Signature

> **get** **admin**(): `boolean` \| `undefined`

Whether they administer the group, when read from its members.

##### Returns

`boolean` \| `undefined`

***

### displayName

#### Get Signature

> **get** **displayName**(): `string` \| `undefined`

Their provider display name, untrusted, when known.

##### Returns

`string` \| `undefined`

***

### mentionToken

#### Get Signature

> **get** **mentionToken**(): `string`

The digits a text reply writes as `@<digits>` to mention them.

##### Returns

`string`

## Methods

### toJSON()

> **toJSON**(): \{ `admin`: `boolean` \| `undefined`; `chat`: `string`; `displayName`: `string` \| `undefined`; `id`: `string`; \}

Serialize the participant reference without credentials.

#### Returns

\{ `admin`: `boolean` \| `undefined`; `chat`: `string`; `displayName`: `string` \| `undefined`; `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `admin` | `boolean` \| `undefined` |
| `chat` | `string` |
| `displayName` | `string` \| `undefined` |
| `id` | `string` |

***

### byId()

> `static` **byId**(`chat`, `id`): `ExternalChatParticipant`

Reference a participant of a chat by provider id.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `chat` | [`ExternalChat`](../../chat/classes/ExternalChat.md) |
| `id` | `string` |

#### Returns

`ExternalChatParticipant`

***

### from()

> `static` **from**(`chat`, `record`): `ExternalChatParticipant`

Seed a participant from the chat's members.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `chat` | [`ExternalChat`](../../chat/classes/ExternalChat.md) |
| `record` | [`ExternalChatParticipant`](../../../../../generated/storage/types.gen/type-aliases/ExternalChatParticipant.md) |

#### Returns

`ExternalChatParticipant`
