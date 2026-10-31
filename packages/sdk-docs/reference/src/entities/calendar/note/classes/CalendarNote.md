# Class: CalendarNote

A markdown document linked to one meeting occurrence, with view-only access.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`MeetingNote`](../../../../../generated/calendar/types.gen/type-aliases/MeetingNote.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-canmanage"></a> `canManage` | `readonly` | () => `Promise`\<`boolean`\> | Whether the caller may change this link's sharing. | - |
| <a id="property-document"></a> `document` | `readonly` | () => `Promise`\<[`Document`](../../../documents/document/classes/Document.md)\> | The original markdown document; unlinking never deletes it. | - |
| <a id="property-event"></a> `event` | `readonly` | [`CalendarEvent`](../../event/classes/CalendarEvent.md) | - | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Current document name. | - |
| <a id="property-occurrence"></a> `occurrence` | `readonly` | `Pick`\<[`CalendarOccurrence`](../../../../../generated/storage/types.gen/type-aliases/CalendarOccurrence.md), `"eventId"` \| `"occurrenceKey"`\> | - | - |
| <a id="property-team"></a> `team` | `readonly` | () => `Promise`\<[`Team`](../../../teams/team/classes/Team.md) \| `undefined`\> | Optional extra team audience. Meeting-detail viewers already have view access. | - |

## Methods

### setTeam()

> **setTeam**(`team?`): `Promise`\<`void`\>

Change the extra team view grant; omit the team to remove it. Requires document ownership.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<`void`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`MeetingNote`](../../../../../generated/calendar/types.gen/type-aliases/MeetingNote.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`MeetingNote`](../../../../../generated/calendar/types.gen/type-aliases/MeetingNote.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`MeetingNote`](../../../../../generated/calendar/types.gen/type-aliases/MeetingNote.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### unlink()

> **unlink**(): `Promise`\<`void`\>

Remove this occurrence's link and view grants, preserving the document and other sharing.

#### Returns

`Promise`\<`void`\>

***

### forDocument()

> `static` **forDocument**(`client`, `event`, `occurrence`, `document`): `CalendarNote`

Construct a handle for a document already linked to this occurrence.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `event` | [`CalendarEvent`](../../event/classes/CalendarEvent.md) |
| `occurrence` | [`CalendarOccurrence`](../../../../../generated/storage/types.gen/type-aliases/CalendarOccurrence.md) |
| `document` | [`Document`](../../../documents/document/classes/Document.md) |

#### Returns

`CalendarNote`

***

### fromDocumentLink()

> `static` **fromDocumentLink**(`client`, `document`, `link`): `CalendarNote`

Seed an owner-visible link that can be revoked even if the meeting is unavailable.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `document` | [`Document`](../../../documents/document/classes/Document.md) |
| `link` | [`DocumentNoteLink`](../../../../../generated/calendar/types.gen/type-aliases/DocumentNoteLink.md) |

#### Returns

`CalendarNote`

***

### fromRecord()

> `static` **fromRecord**(`client`, `event`, `occurrence`, `record`): `CalendarNote`

Seed a handle with a record returned by the meeting-note API.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `event` | [`CalendarEvent`](../../event/classes/CalendarEvent.md) |
| `occurrence` | [`CalendarOccurrence`](../../../../../generated/storage/types.gen/type-aliases/CalendarOccurrence.md) |
| `record` | [`MeetingNote`](../../../../../generated/calendar/types.gen/type-aliases/MeetingNote.md) |

#### Returns

`CalendarNote`
