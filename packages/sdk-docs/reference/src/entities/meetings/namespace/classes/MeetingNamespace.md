# Class: MeetingNamespace

Meeting schedules and invitation lookup.

## Constructors

### Constructor

> **new MeetingNamespace**(`client`): `MeetingNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`MeetingNamespace`

## Methods

### active()

> **active**(): `Promise`\<[`Meeting`](../../meeting/classes/Meeting.md)[]\>

List active meetings.

#### Returns

`Promise`\<[`Meeting`](../../meeting/classes/Meeting.md)[]\>

***

### byId()

> **byId**(`id`): [`Meeting`](../../meeting/classes/Meeting.md)

Construct a handle to one of the caller's newest 100 standalone meetings. Use lookup for invitations.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Meeting`](../../meeting/classes/Meeting.md)

***

### create()

> **create**(`options`): `Promise`\<[`Meeting`](../../meeting/classes/Meeting.md)\>

Create a meeting.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Omit`\<[`CreateMeetingRequest`](../../../../../generated/storage/types.gen/type-aliases/CreateMeetingRequest.md), `"preparationId"`\> |

#### Returns

`Promise`\<[`Meeting`](../../meeting/classes/Meeting.md)\>

***

### list()

> **list**(): `Promise`\<[`Meeting`](../../meeting/classes/Meeting.md)[]\>

List the caller's newest 100 standalone meetings.

#### Returns

`Promise`\<[`Meeting`](../../meeting/classes/Meeting.md)[]\>

***

### lookup()

> **lookup**(`token`): `Promise`\<[`Meeting`](../../meeting/classes/Meeting.md)\>

Resolve a meeting's invitation token.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | `string` |

#### Returns

`Promise`\<[`Meeting`](../../meeting/classes/Meeting.md)\>
