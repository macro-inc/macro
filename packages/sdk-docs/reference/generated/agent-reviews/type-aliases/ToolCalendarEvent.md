# Type Alias: ToolCalendarEvent

> **ToolCalendarEvent** = \{ `attendeeCount`: `number`; `attendees`: [`ToolEventAttendee`](ToolEventAttendee.md)[]; `calendarId`: `string` \| `null`; `calendarName`: `string` \| `null`; `conferenceUrl`: `string` \| `null`; `description`: `string` \| `null`; `end`: `string`; `eventId`: `string`; `inbox`: `string` \| `null`; `isAllDay`: `boolean`; `isReadOnly`: `boolean`; `isRecurring`: `boolean`; `location`: `string` \| `null`; `macroCallUrl`: `string` \| `null`; `myRole`: [`ToolEventRole`](ToolEventRole.md) \| `null`; `organizerEmail`: `string` \| `null`; `recurrenceLines`: `string`[]; `start`: `string`; `status`: `string`; `timeZone`: `string` \| `null`; `title`: `string`; \}

A calendar event as returned by the create and update tools.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendeecount"></a> `attendeeCount` | `number` | Total number of attendees. |
| <a id="property-attendees"></a> `attendees` | [`ToolEventAttendee`](ToolEventAttendee.md)[] | Attendees, capped at 20; `attendee_count` has the full number. |
| <a id="property-calendarid"></a> `calendarId` | `string` \| `null` | Calendar the event belongs to, when known. |
| <a id="property-calendarname"></a> `calendarName` | `string` \| `null` | Display name of that calendar, when known. |
| <a id="property-conferenceurl"></a> `conferenceUrl` | `string` \| `null` | Conference join URL, when a conference is attached. |
| <a id="property-description"></a> `description` | `string` \| `null` | Event body, truncated for brevity. |
| <a id="property-end"></a> `end` | `string` | Exclusive event end: RFC 3339 UTC instant, or YYYY-MM-DD for all-day events. |
| <a id="property-eventid"></a> `eventId` | `string` | Macro calendar event id, used by UpdateCalendarEvent and DeleteCalendarEvent. |
| <a id="property-inbox"></a> `inbox` | `string` \| `null` | Connected inbox address syncing the calendar, when known. It stays the user's own address on a colleague's calendar, so it never says whose calendar it is. |
| <a id="property-isallday"></a> `isAllDay` | `boolean` | Whether the event covers whole days. |
| <a id="property-isreadonly"></a> `isReadOnly` | `boolean` | Whether the user's calendar prohibits modifying this event. |
| <a id="property-isrecurring"></a> `isRecurring` | `boolean` | Whether the event recurs. |
| <a id="property-location"></a> `location` | `string` \| `null` | Location label, when set. |
| <a id="property-macrocallurl"></a> `macroCallUrl` | `string` \| `null` | Join URL of the Macro call created with the event, when CreateCalendarEvent was asked for one. |
| <a id="property-myrole"></a> `myRole` | [`ToolEventRole`](ToolEventRole.md) \| `null` | Whether the user organizes this event or is a guest on it, through that inbox; absent when they are neither, can only write that calendar, or a read-only calendar names them organizer. |
| <a id="property-organizeremail"></a> `organizerEmail` | `string` \| `null` | Organizer email address, when known. |
| <a id="property-recurrencelines"></a> `recurrenceLines` | `string`[] | Raw RFC 5545 recurrence properties, when the event recurs. |
| <a id="property-start"></a> `start` | `string` | Event start: RFC 3339 UTC instant, or YYYY-MM-DD for all-day events. |
| <a id="property-status"></a> `status` | `string` | Event status: confirmed, tentative, or cancelled. |
| <a id="property-timezone"></a> `timeZone` | `string` \| `null` | IANA time zone the event was scheduled in, when known. |
| <a id="property-title"></a> `title` | `string` | Display title. |
