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
| <a id="property-guestpolicy"></a> `guestPolicy` | `readonly` | () => `Promise`\<[`GuestPolicy`](../../../../../generated/calendar/types.gen/type-aliases/GuestPolicy.md)\> | What the organizer lets guests do: modify, invite others, see the guest list. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-isreadonly"></a> `isReadOnly` | `readonly` | () => `Promise`\<`boolean`\> | Whether the canonical source's calendar prohibits editing. | - |
| <a id="property-location"></a> `location` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Optional physical or virtual location label. | - |
| <a id="property-recurrencelines"></a> `recurrenceLines` | `readonly` | () => `Promise`\<`string`[]\> | Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`). | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<[`EventStatus`](../../../../../generated/calendar/types.gen/type-aliases/EventStatus.md)\> | Event status. | - |
| <a id="property-time"></a> `time` | `readonly` | () => `Promise`\<[`EventTime`](../../../../../generated/calendar/types.gen/type-aliases/EventTime.md)\> | Timed or all-day shape. | - |
| <a id="property-title"></a> `title` | `readonly` | () => `Promise`\<`string`\> | Display title. | - |
| <a id="property-transparency"></a> `transparency` | `readonly` | () => `Promise`\<[`EventTransparency`](../../../../../generated/calendar/types.gen/type-aliases/EventTransparency.md)\> | Availability behavior. | - |
| <a id="property-viewercan"></a> `viewerCan` | `readonly` | () => `Promise`\<[`ViewerCapabilities`](../../../../../generated/calendar/types.gen/type-aliases/ViewerCapabilities.md)\> | What the connected account may do with this event under its guest policy. | - |

## Methods

### addToCalendar()

> **addToCalendar**(`options?`): `Promise`\<`CalendarEvent`\>

Add a snapshot of an event shared with one of the requester's
channels to one of their Google calendars, and return a handle to the
synced snapshot. The snapshot keeps the meeting's iCalendar UID and
organizer, lists only the requester as a guest, and carries no join link;
nobody is notified, and answers or guests on it never reach the meeting.
Refused with `already_on_calendar` when the meeting is already on one of
their calendars, with `join_request_open` while their request to join it
is pending or accepted (the meeting then arrives as an invitation), and
with `copy_refused` when Google will not import it.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `calendar?`: [`Calendar`](../../calendar/classes/Calendar.md); \} |
| `options.calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) |

#### Returns

`Promise`\<`CalendarEvent`\>

***

### delete()

> **delete**(`options?`): `Promise`\<`void`\>

Delete the event (or a scoped part of a recurring series) at its provider.

A meeting on more than one of the user's inboxes is one event per inbox.
Before deleting any of them, ask the user which inbox's copy to delete,
then pass that copy's `inbox`. Never choose between the user's inboxes
yourself, whatever they look like: a test, secondary or unfamiliar address
is still the user's own inbox. Skip the question only when the user
already named the inbox, or when only one copy can be deleted; then delete
that copy and say why. Without `inbox` the call is refused with
`copy_choice_required`, listing each copy and the question to ask.

Deleting the copy the user organizes cancels the meeting for every guest.
Deleting a copy where they are a guest takes the meeting off that inbox's
calendar: on Google it also declines the invitation and tells the
organizer, while on Outlook the organizer is not told and still sees the
invitation unanswered.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | [`DeleteEventOptions`](../interfaces/DeleteEventOptions.md) |

#### Returns

`Promise`\<`void`\>

***

### ics()

> **ics**(): `Promise`\<`string`\>

The event as an iCalendar (`.ics`) document: its series, title,
description, location and organizer, never its guests or join link.
Available for the requester's own events and ones shared with a channel
they belong to.

#### Returns

`Promise`\<`string`\>

***

### inviteGuests()

> **inviteGuests**(`options`): `Promise`\<`CalendarEvent`\>

Add guests without touching anyone already invited, and return a handle
to the synced record.

When the meeting is on more than one of the user's inboxes, add from the
copy the user organizes when there is one (it invites directly, while a
guest's copy invites only as far as the organizer allows) and say why;
otherwise ask the user which inbox's copy to add them from. Never choose
between the user's inboxes any other way, whatever they look like. Pass
that copy's `inbox`; without it the call is refused with
`copy_choice_required`, listing each copy and the question to ask.

The organizer may add guests, and so may a guest the organizer lets
invite others (see [CalendarEvent.viewerCan](#property-viewercan)); Google emails the
new guests.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`InviteGuestsOptions`](../interfaces/InviteGuestsOptions.md) |

#### Returns

`Promise`\<`CalendarEvent`\>

***

### linkNote()

> **linkNote**(`document`, `occurrence`, `options?`): `Promise`\<[`CalendarNote`](../../note/classes/CalendarNote.md)\>

Link a markdown document you own. Meeting-detail viewers gain read access;
an optional team gains read access too. Editing and other sharing are preserved.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `document` | [`Document`](../../../documents/document/classes/Document.md) |
| `occurrence` | [`CalendarOccurrence`](../../../../../generated/storage/types.gen/type-aliases/CalendarOccurrence.md) |
| `options?` | \{ `team?`: [`Team`](../../../teams/team/classes/Team.md); \} |
| `options.team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<[`CalendarNote`](../../note/classes/CalendarNote.md)\>

***

### notes()

> **notes**(`occurrence`): `Promise`\<[`CalendarNote`](../../note/classes/CalendarNote.md)[]\>

Notes linked to a specific occurrence returned by `calendar.occurrences()`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `occurrence` | [`CalendarOccurrence`](../../../../../generated/storage/types.gen/type-aliases/CalendarOccurrence.md) |

#### Returns

`Promise`\<[`CalendarNote`](../../note/classes/CalendarNote.md)[]\>

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

A meeting on more than one of the user's inboxes is one event per inbox,
each with its own id (see the occurrence listing's `inbox` and `role`).
Before changing its details, guests or guest permissions, ask the user
which inbox's copy to change, then pass that copy's `inbox`. Never choose
between the user's inboxes yourself, whatever they look like: a test,
secondary or unfamiliar address is still the user's own inbox. Skip the
question only when the user already named the inbox, when only one copy's
`viewerCan` allows the change (use it and say why), or when adding guests
to a meeting the user organizes from one of the inboxes (add them from
that copy and say why). Reminders belong to one copy, so set them on one
copy and say which inbox you used. Without `inbox` the call is refused
with `copy_choice_required`, listing each copy and the question to ask.

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
