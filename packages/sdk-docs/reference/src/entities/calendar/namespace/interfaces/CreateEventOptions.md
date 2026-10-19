# Interface: CreateEventOptions

Fields for a new calendar event.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees?` | [`CalendarAttendeeInputBody`](../../../../../generated/calendar/types.gen/type-aliases/CalendarAttendeeInputBody.md)[] | Invited attendees. |
| <a id="property-calendar"></a> `calendar?` | [`Calendar`](../../calendar/classes/Calendar.md) | Exact calendar to create the event on; takes precedence over the inbox default. |
| <a id="property-conference"></a> `conference?` | [`ConferenceChange`](../../../../../generated/calendar/types.gen/type-aliases/ConferenceChange.md) | Conference to attach; omit to create the event without one. |
| <a id="property-description"></a> `description?` | `string` | Optional event body. |
| <a id="property-emaillink"></a> `emailLink?` | [`Link`](../../../email/link/classes/Link.md) | Connected inbox whose primary calendar receives the event; defaults to the requester's primary inbox. |
| <a id="property-location"></a> `location?` | `string` | Optional location label. |
| <a id="property-macrocall"></a> `macroCall?` | `boolean` | Mint a Macro call with the event; its join link lands in the description and location. Cannot be combined with `conference`. |
| <a id="property-outofoffice"></a> `outOfOffice?` | [`OutOfOfficeProperties`](../../../../../generated/calendar/types.gen/type-aliases/OutOfOfficeProperties.md) | Out-of-office properties; present to create an out-of-office event. |
| <a id="property-recurrencelines"></a> `recurrenceLines?` | `string`[] | Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`). |
| <a id="property-reminders"></a> `reminders?` | [`EventReminders`](../../../../../generated/calendar/types.gen/type-aliases/EventReminders.md) | Reminder configuration; omit to keep the calendar defaults. |
| <a id="property-time"></a> `time` | [`EventTime`](../../../../../generated/calendar/types.gen/type-aliases/EventTime.md) | Timed or all-day shape. |
| <a id="property-title"></a> `title` | `string` | Display title. |
| <a id="property-transparency"></a> `transparency?` | [`EventTransparency`](../../../../../generated/calendar/types.gen/type-aliases/EventTransparency.md) | Availability behavior. |
| <a id="property-visibility"></a> `visibility?` | [`EventVisibility`](../../../../../generated/calendar/types.gen/type-aliases/EventVisibility.md) | Event visibility. |
