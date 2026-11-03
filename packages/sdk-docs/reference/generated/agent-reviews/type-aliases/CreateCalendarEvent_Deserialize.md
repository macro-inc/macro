# Type Alias: CreateCalendarEvent\_Deserialize

> **CreateCalendarEvent\_Deserialize** = \{ `addMacroCall?`: `boolean`; `attendees?`: [`AttendeeInput`](AttendeeInput.md)[]; `calendarId?`: `string` \| `null`; `description?`: `string` \| `null`; `eventType?`: [`CalendarEventTypeInput`](CalendarEventTypeInput.md); `guestPolicy?`: [`GuestPolicy`](GuestPolicy.md) \| `null`; `location?`: `string` \| `null`; `outOfOffice?`: [`OutOfOfficeInput`](OutOfOfficeInput.md) \| `null`; `recurrenceLines?`: `string`[]; `reminders?`: [`EventRemindersInput`](EventRemindersInput.md) \| `null`; `time`: [`EventTimeInput`](EventTimeInput.md); `title`: `string`; \} & \{ `addConference?`: `boolean`; \} \| \{ `addGoogleMeet?`: `boolean`; \}

Create a calendar event.

## Union Members

\{ `addMacroCall?`: `boolean`; `attendees?`: [`AttendeeInput`](AttendeeInput.md)[]; `calendarId?`: `string` \| `null`; `description?`: `string` \| `null`; `eventType?`: [`CalendarEventTypeInput`](CalendarEventTypeInput.md); `guestPolicy?`: [`GuestPolicy`](GuestPolicy.md) \| `null`; `location?`: `string` \| `null`; `outOfOffice?`: [`OutOfOfficeInput`](OutOfOfficeInput.md) \| `null`; `recurrenceLines?`: `string`[]; `reminders?`: [`EventRemindersInput`](EventRemindersInput.md) \| `null`; `time`: [`EventTimeInput`](EventTimeInput.md); `title`: `string`; \} & \{ `addConference?`: `boolean`; \}

***

### Type Literal

\{ `addGoogleMeet?`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `addGoogleMeet?` | `boolean` | Whether to attach the calendar provider's meeting conference. |
