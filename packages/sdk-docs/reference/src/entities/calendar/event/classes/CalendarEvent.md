# Class: CalendarEvent

A Macro calendar event: a handle exposing the event's synced fields and the
mutations that act on it ([CalendarEvent.update](#update),
[CalendarEvent.delete](#delete), [CalendarEvent.rsvp](#rsvp)).

The calendar service has no fetch-by-id endpoint, so a handle reads its
fields only when seeded with a record — as returned by
[CalendarEvent.update](#update), [CalendarEvent.rsvp](#rsvp), or
`calendar.createEvent`. A bare [CalendarEvent.byId](#byid) handle can drive
mutations, but reading a field on it throws.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`CalendarEvent`](../../../../../generated/calendar/types.gen/type-aliases/CalendarEvent.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees` | `readonly` | () => `Promise`\<[`CalendarAttendee`](../../../../../generated/calendar/types.gen/type-aliases/CalendarAttendee.md)[]\> | Attendees on the canonical copy. | - |
| <a id="property-calendar"></a> `calendar` | `readonly` | () => `Promise`\<[`Calendar`](../../calendar/classes/Calendar.md) \| `undefined`\> | The calendar the canonical source belongs to, when known. | - |
| <a id="property-description"></a> `description` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Optional event body. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-isreadonly"></a> `isReadOnly` | `readonly` | () => `Promise`\<`boolean`\> | Whether the canonical source's calendar prohibits editing. | - |
| <a id="property-location"></a> `location` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Optional physical or virtual location label. | - |
| <a id="property-recurrencelines"></a> `recurrenceLines` | `readonly` | () => `Promise`\<`string`[]\> | Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`). | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<[`EventStatus`](../../../../../generated/calendar/types.gen/type-aliases/EventStatus.md)\> | Event status. | - |
| <a id="property-time"></a> `time` | `readonly` | () => `Promise`\<[`EventTime`](../../../../../generated/calendar/types.gen/type-aliases/EventTime.md)\> | Timed or all-day shape. | - |
| <a id="property-title"></a> `title` | `readonly` | () => `Promise`\<`string`\> | Display title. | - |
| <a id="property-transparency"></a> `transparency` | `readonly` | () => `Promise`\<[`EventTransparency`](../../../../../generated/calendar/types.gen/type-aliases/EventTransparency.md)\> | Availability behavior. | - |

## Methods

### delete()

> **delete**(`options?`): `Promise`\<`void`\>

Delete the event (or a scoped part of a recurring series) at its provider.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | [`DeleteEventOptions`](../interfaces/DeleteEventOptions.md) |

#### Returns

`Promise`\<`void`\>

***

### prepareReplacement()

> **prepareReplacement**(`options`): `Promise`\<[`CalendarReplacement`](../../replacement/classes/CalendarReplacement.md)\>

Preview an organizer replacement without cancelling or sending invitations.
Review replacement.status() before explicitly calling replacement.confirm().

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `calendar?`: [`Calendar`](../../calendar/classes/Calendar.md); `recurrenceId?`: `string`; `removeConference`: `boolean`; \} |
| `options.calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) |
| `options.recurrenceId?` | `string` |
| `options.removeConference` | `boolean` |

#### Returns

`Promise`\<[`CalendarReplacement`](../../replacement/classes/CalendarReplacement.md)\>

***

### providerUrl()

> **providerUrl**(`options?`): `Promise`\<`string` \| `undefined`\>

Open this calendar copy in its provider for actions unavailable through its API.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `calendar?`: [`Calendar`](../../calendar/classes/Calendar.md); `recurrenceId?`: `string`; \} |
| `options.calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) |
| `options.recurrenceId?` | `string` |

#### Returns

`Promise`\<`string` \| `undefined`\>

***

### record()

> **record**(): `Promise`\<[`CalendarEvent`](../../../../../generated/calendar/types.gen/type-aliases/CalendarEvent.md)\>

The full synced event record. Available on a seeded handle (from create /
update / rsvp); a bare `byId` handle throws (no fetch-by-id endpoint).

#### Returns

`Promise`\<[`CalendarEvent`](../../../../../generated/calendar/types.gen/type-aliases/CalendarEvent.md)\>

***

### rsvp()

> **rsvp**(`options`): `Promise`\<`CalendarEvent`\>

Record the requester's RSVP and return a handle to the synced record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RsvpEventOptions`](../interfaces/RsvpEventOptions.md) |

#### Returns

`Promise`\<`CalendarEvent`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`CalendarEvent`](../../../../../generated/calendar/types.gen/type-aliases/CalendarEvent.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`CalendarEvent`](../../../../../generated/calendar/types.gen/type-aliases/CalendarEvent.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`CalendarEvent`](../../../../../generated/calendar/types.gen/type-aliases/CalendarEvent.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`options`): `Promise`\<`CalendarEvent`\>

Update the event and return a handle to its synced record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`UpdateEventOptions`](../interfaces/UpdateEventOptions.md) |

#### Returns

`Promise`\<`CalendarEvent`\>

***

### byId()

> `static` **byId**(`client`, `id`): `CalendarEvent`

A handle to a calendar event by id, for driving mutations. Reading a
field on it throws (there is no fetch-by-id endpoint).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`CalendarEvent`

***

### fromRecord()

> `static` **fromRecord**(`client`, `record`): `CalendarEvent`

A handle seeded with a synced event record; reads resolve without a fetch.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`CalendarEvent`](../../../../../generated/calendar/types.gen/type-aliases/CalendarEvent.md) |

#### Returns

`CalendarEvent`
