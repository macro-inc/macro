# Type Alias: CreateCalendarEvent\_Serialize

> **CreateCalendarEvent\_Serialize** = \{ `addConference`: `boolean`; `addMacroCall`: `boolean`; `attendees`: [`AttendeeInput`](AttendeeInput.md)[]; `calendarId`: `string` \| `null`; `description`: `string` \| `null`; `eventType`: [`CalendarEventTypeInput`](CalendarEventTypeInput.md); `guestPolicy`: [`GuestPolicy`](GuestPolicy.md) \| `null`; `location`: `string` \| `null`; `outOfOffice`: [`OutOfOfficeInput`](OutOfOfficeInput.md) \| `null`; `recurrenceLines`: `string`[]; `reminders`: [`EventRemindersInput`](EventRemindersInput.md) \| `null`; `time`: [`EventTimeInput`](EventTimeInput.md); `title`: `string`; \}

Create a calendar event.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-addconference"></a> `addConference` | `boolean` | Whether to attach the calendar provider's meeting conference. |
| <a id="property-addmacrocall"></a> `addMacroCall` | `boolean` | Whether to attach a Macro meeting link. |
| <a id="property-attendees"></a> `attendees` | [`AttendeeInput`](AttendeeInput.md)[] | Attendees to invite. |
| <a id="property-calendarid"></a> `calendarId` | `string` \| `null` | Calendar to create the event on. |
| <a id="property-description"></a> `description` | `string` \| `null` | Optional event body. |
| <a id="property-eventtype"></a> `eventType` | [`CalendarEventTypeInput`](CalendarEventTypeInput.md) | Kind of event to create. |
| <a id="property-guestpolicy"></a> `guestPolicy` | [`GuestPolicy`](GuestPolicy.md) \| `null` | What guests may do with the event. |
| <a id="property-location"></a> `location` | `string` \| `null` | Optional location label. |
| <a id="property-outofoffice"></a> `outOfOffice` | [`OutOfOfficeInput`](OutOfOfficeInput.md) \| `null` | Out-of-office decline behavior. |
| <a id="property-recurrencelines"></a> `recurrenceLines` | `string`[] | Recurrence properties. |
| <a id="property-reminders"></a> `reminders` | [`EventRemindersInput`](EventRemindersInput.md) \| `null` | Reminder configuration. |
| <a id="property-time"></a> `time` | [`EventTimeInput`](EventTimeInput.md) | Timed or all-day span. |
| <a id="property-title"></a> `title` | `string` | Display title. |
