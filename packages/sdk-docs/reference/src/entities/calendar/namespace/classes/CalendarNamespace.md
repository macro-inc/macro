# Class: CalendarNamespace

The calendar surface: every calendar the caller can see (not all of them
theirs), event creation, and handles to individual events and calendars.
Backed by calendar_service (the SDK reaches it on the gateway's `/calendar`
route).

The user can see calendars that are not theirs, such as a colleague's or a
team's. `inbox` is the account syncing a calendar, so it stays the user's
own address on all of them, and neither it, `isPrimary`, `isWritable` nor
`role` says whose calendar it is. Their schedule is the calendars with
`contributesToAvailability`, plus meetings they attend: only those are
"your calendar", and only those are conflicts when finding free time, as in
team availability. Anything else is what that calendar shows, not where the
user is or what they are doing. Call it by `calendarName`, say whose it is
when the name shows that, and otherwise say you cannot tell rather than
guess. When it overlaps a time you suggest, mention it so the user can
decide, since their own other calendars read the same way.

A meeting on more than one of the user's inboxes is one event per inbox;
[CalendarNamespace.occurrences](#occurrences) lists each copy with its `inbox` and
`role`. Before changing such a meeting's details, guests or guest
permissions, or deleting it, ask the user which inbox's copy to change, then
pass that copy's `inbox` to [CalendarEvent.update](../../event/classes/CalendarEvent.md#update),
[CalendarEvent.inviteGuests](../../event/classes/CalendarEvent.md#inviteguests) or [CalendarEvent.delete](../../event/classes/CalendarEvent.md#delete). Never
choose between the user's inboxes yourself, whatever they look like: a
test, secondary or unfamiliar address is still the user's own inbox. Skip
the question only when the user already named the inbox, when only one copy
can make the change, or when adding guests from the copy the user
organizes, and say why. Reminders may go to one copy; name its inbox. Read
those three methods' documentation before changing a meeting held through
several inboxes: it says what each change does from each copy.

[CalendarEvent.addToCalendar](../../event/classes/CalendarEvent.md#addtocalendar) adds a shared meeting only while none
of the user's calendars holds it. Refused with `already_on_calendar`, it is
refused on every calendar, so tell the user the meeting is already on their
calendar and never offer to add it to another one.

## Constructors

### Constructor

> **new CalendarNamespace**(`client`): `CalendarNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`CalendarNamespace`

## Methods

### availabilityCalendars()

> **availabilityCalendars**(): `Promise`\<\{ `calendar`: [`Calendar`](../../calendar/classes/Calendar.md); `contributesToAvailability`: `boolean`; `isPrimary`: `boolean`; `name`: `string`; \}[]\>

Calendar availability settings, each referring to a typed calendar.

#### Returns

`Promise`\<\{ `calendar`: [`Calendar`](../../calendar/classes/Calendar.md); `contributesToAvailability`: `boolean`; `isPrimary`: `boolean`; `name`: `string`; \}[]\>

***

### calendar()

> **calendar**(`id`): [`Calendar`](../../calendar/classes/Calendar.md)

A handle to a calendar by id. Detail loads on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Calendar`](../../calendar/classes/Calendar.md)

***

### calendars()

> **calendars**(): `Promise`\<[`Calendar`](../../calendar/classes/Calendar.md)[]\>

The calendars the caller can see, some possibly not theirs, primaries and writable first.

#### Returns

`Promise`\<[`Calendar`](../../calendar/classes/Calendar.md)[]\>

***

### createEvent()

> **createEvent**(`options`): `Promise`\<[`CalendarEvent`](../../event/classes/CalendarEvent.md)\>

Create a calendar event and return a handle to its synced record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`CreateEventOptions`](../interfaces/CreateEventOptions.md) |

#### Returns

`Promise`\<[`CalendarEvent`](../../event/classes/CalendarEvent.md)\>

***

### event()

> **event**(`id`): [`CalendarEvent`](../../event/classes/CalendarEvent.md)

A handle to a calendar event by id, for driving mutations.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`CalendarEvent`](../../event/classes/CalendarEvent.md)

***

### noteDocuments()

> **noteDocuments**(`query?`): `Promise`\<\{ `documents`: \{ `document`: [`Document`](../../../documents/document/classes/Document.md); `name`: `string`; \}[]; `teams`: \{ `name`: `string`; `team`: [`Team`](../../../teams/team/classes/Team.md); \}[]; \}\>

Find up to 30 owned markdown documents for meeting notes, plus available extra team audiences.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `query?` | `string` | `''` |

#### Returns

`Promise`\<\{ `documents`: \{ `document`: [`Document`](../../../documents/document/classes/Document.md); `name`: `string`; \}[]; `teams`: \{ `name`: `string`; `team`: [`Team`](../../../teams/team/classes/Team.md); \}[]; \}\>

***

### occurrences()

> **occurrences**(`options`): `AsyncGenerator`\<\{ `calendarName`: `string` \| `undefined`; `contributesToAvailability`: `boolean` \| `undefined`; `event`: [`CalendarEvent`](../../event/classes/CalendarEvent.md); `inbox`: `string` \| `undefined`; `occurrence`: [`CalendarOccurrence`](../../../../../generated/storage/types.gen/type-aliases/CalendarOccurrence.md); `role`: [`CalendarEventRole`](../type-aliases/CalendarEventRole.md) \| `undefined`; \}, `any`, `any`\>

Occurrences on every calendar the user can see: their schedule is only
`contributesToAvailability` rows and meetings they attend; call the rest
by `calendarName`. Automatically paginated within the viewport. Each names
its calendar (`calendarName`), whether a calendar holding it is on the
user's schedule (`contributesToAvailability`), the address of the
connected inbox holding that copy of the event (`inbox`) and whether the
user organizes it or is a guest there (`role`, absent when neither, or
when they can only write that calendar).

`inbox` is the account syncing the calendar, so a colleague's calendar
reports the user's own address; it never says whose calendar it is, and
neither does `role`, since writing someone's calendar lets the user act
as its organizer. Say "your calendar", and count a conflict or busy time,
only for `contributesToAvailability` rows and meetings the user attends
(`role`), the way team availability does. Any other row is what that
calendar shows, not where the user is or what they are doing: "the
Offsites calendar has...", or "alex@example.com's calendar has..." when
the name shows whose it is. If it does not, say you cannot tell rather
than guess. When one overlaps a time you suggest, mention it so the user
can decide, since their own other calendars read the same way.

A meeting on several of the user's inboxes appears once per inbox, each
with its own event; describe them by inbox and role, never by id.

Before changing or deleting such a meeting, ask the user which inbox's
copy to change, unless they named it, only one copy can make the change,
or you add guests from the copy they organize. Never choose between the
user's inboxes yourself, whatever they look like. Pass the chosen copy's
`inbox` to its `update`, `inviteGuests` or `delete`; without it the call
is refused with `copy_choice_required`, which names each copy's inbox and
event and gives the question to ask. An occurrence whose calendar is no
longer listed has no `inbox`; take it from that refusal.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `Omit`\<[`ListOccurrencesData`](../../../../../generated/storage/types.gen/type-aliases/ListOccurrencesData.md)\[`"query"`\], `"cursor"`\> |

#### Returns

`AsyncGenerator`\<\{ `calendarName`: `string` \| `undefined`; `contributesToAvailability`: `boolean` \| `undefined`; `event`: [`CalendarEvent`](../../event/classes/CalendarEvent.md); `inbox`: `string` \| `undefined`; `occurrence`: [`CalendarOccurrence`](../../../../../generated/storage/types.gen/type-aliases/CalendarOccurrence.md); `role`: [`CalendarEventRole`](../type-aliases/CalendarEventRole.md) \| `undefined`; \}, `any`, `any`\>

***

### replacement()

> **replacement**(`operationId`): [`CalendarReplacement`](../../replacement/classes/CalendarReplacement.md)

Recover a saved replacement, including after its original event was retired.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `operationId` | `string` |

#### Returns

[`CalendarReplacement`](../../replacement/classes/CalendarReplacement.md)

***

### setTeamSharing()

> **setTeamSharing**(`sharing`): `Promise`\<[`TeamCalendarSharing`](../../../../../generated/calendar/types.gen/type-aliases/TeamCalendarSharing.md)\>

Replace the team calendar sharing preference.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sharing` | [`TeamCalendarSharing`](../../../../../generated/calendar/types.gen/type-aliases/TeamCalendarSharing.md) |

#### Returns

`Promise`\<[`TeamCalendarSharing`](../../../../../generated/calendar/types.gen/type-aliases/TeamCalendarSharing.md)\>

***

### teamOutOfOffice()

> **teamOutOfOffice**(`options`): `Promise`\<\{ `hasMore`: `boolean`; `items`: \{ `event`: [`CalendarEvent`](../../event/classes/CalendarEvent.md); `occurrenceKey`: `string`; `owner`: [`User`](../../../users/user/classes/User.md); `time`: [`EventTime`](../../../../../generated/storage/types.gen/type-aliases/EventTime.md); `title`: `string` \| `undefined`; \}[]; \}\>

Teammates' out-of-office occurrences in a bounded viewport. Check hasMore for truncation.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | \{ `end`: `string`; `endDate?`: `string`; `limit?`: `number`; `start`: `string`; `startDate?`: `string`; \} | - |
| `options.end` | `string` | Exclusive UTC viewport end. |
| `options.endDate?` | `string` | Exclusive local date boundary for all-day events. |
| `options.limit?` | `number` | Maximum number of occurrences, from 1 through 2,000. |
| `options.start` | `string` | Inclusive UTC viewport start. |
| `options.startDate?` | `string` | Inclusive local date boundary for all-day events. |

#### Returns

`Promise`\<\{ `hasMore`: `boolean`; `items`: \{ `event`: [`CalendarEvent`](../../event/classes/CalendarEvent.md); `occurrenceKey`: `string`; `owner`: [`User`](../../../users/user/classes/User.md); `time`: [`EventTime`](../../../../../generated/storage/types.gen/type-aliases/EventTime.md); `title`: `string` \| `undefined`; \}[]; \}\>

***

### teamPage()

> **teamPage**(`options`): `Promise`\<\{ `items`: (\{ `contributesToAvailability`: `boolean`; `id`: `string`; `kind`: `"busy"`; `owner`: [`User`](../../../users/user/classes/User.md); `time`: [`EventTime`](../../../../../generated/storage/types.gen/type-aliases/EventTime.md); \} \| \{ `contributesToAvailability`: `boolean`; `details`: [`TeamCalendarDetails`](../../../../../generated/storage/types.gen/type-aliases/TeamCalendarDetails.md); `id`: `string`; `kind`: `"details"`; `owner`: [`User`](../../../users/user/classes/User.md); `time`: [`EventTime`](../../../../../generated/storage/types.gen/type-aliases/EventTime.md); \})[]; `members`: \{ `coverage`: [`TeamCalendarCoverage`](../../../../../generated/storage/types.gen/type-aliases/TeamCalendarCoverage.md); `sharing`: [`TeamCalendarSharing`](../../../../../generated/storage/types.gen/type-aliases/TeamCalendarSharing.md); `user`: [`User`](../../../users/user/classes/User.md); \}[]; `nextCursor`: `string` \| `undefined`; \}\>

A page of team availability, including its roster and continuation cursor.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | \{ `cursor?`: `string` \| `null`; `end`: `string`; `limit?`: `number` \| `null`; `start`: `string`; \} | - |
| `options.cursor?` | `string` \| `null` | Continuation returned by the preceding page. |
| `options.end` | `string` | Exclusive instant. |
| `options.limit?` | `number` \| `null` | Maximum source occurrences, at most 2,000. Zero returns the roster only. |
| `options.start` | `string` | Inclusive instant. |

#### Returns

`Promise`\<\{ `items`: (\{ `contributesToAvailability`: `boolean`; `id`: `string`; `kind`: `"busy"`; `owner`: [`User`](../../../users/user/classes/User.md); `time`: [`EventTime`](../../../../../generated/storage/types.gen/type-aliases/EventTime.md); \} \| \{ `contributesToAvailability`: `boolean`; `details`: [`TeamCalendarDetails`](../../../../../generated/storage/types.gen/type-aliases/TeamCalendarDetails.md); `id`: `string`; `kind`: `"details"`; `owner`: [`User`](../../../users/user/classes/User.md); `time`: [`EventTime`](../../../../../generated/storage/types.gen/type-aliases/EventTime.md); \})[]; `members`: \{ `coverage`: [`TeamCalendarCoverage`](../../../../../generated/storage/types.gen/type-aliases/TeamCalendarCoverage.md); `sharing`: [`TeamCalendarSharing`](../../../../../generated/storage/types.gen/type-aliases/TeamCalendarSharing.md); `user`: [`User`](../../../users/user/classes/User.md); \}[]; `nextCursor`: `string` \| `undefined`; \}\>

***

### teamSharing()

> **teamSharing**(): `Promise`\<[`TeamCalendarSharing`](../../../../../generated/calendar/types.gen/type-aliases/TeamCalendarSharing.md)\>

Current sharing preference for the team calendar.

#### Returns

`Promise`\<[`TeamCalendarSharing`](../../../../../generated/calendar/types.gen/type-aliases/TeamCalendarSharing.md)\>
