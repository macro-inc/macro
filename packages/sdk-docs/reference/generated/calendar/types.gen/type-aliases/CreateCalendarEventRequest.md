# Type Alias: CreateCalendarEventRequest

> **CreateCalendarEventRequest** = \{ `attendees?`: [`CalendarAttendeeInputBody`](CalendarAttendeeInputBody.md)[]; `calendarId?`: `string` \| `null`; `conference?`: `null` \| [`ConferenceChange`](ConferenceChange.md); `description?`: `string` \| `null`; `emailLinkId?`: `string` \| `null`; `idempotencyKey?`: `string` \| `null`; `location?`: `string` \| `null`; `outOfOffice?`: `null` \| [`OutOfOfficeProperties`](OutOfOfficeProperties.md); `recurrenceLines?`: `string`[]; `reminders?`: `null` \| [`EventReminders`](EventReminders.md); `time`: [`EventTime`](EventTime.md); `title`: `string`; `transparency?`: `null` \| [`EventTransparency`](EventTransparency.md); `visibility?`: `null` \| [`EventVisibility`](EventVisibility.md); \}

Request body creating a calendar event on the requester's calendar.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees?` | [`CalendarAttendeeInputBody`](CalendarAttendeeInputBody.md)[] | Invited attendees. |
| <a id="property-calendarid"></a> `calendarId?` | `string` \| `null` | Exact calendar to create the event on; takes precedence over the inbox default. |
| <a id="property-conference"></a> `conference?` | `null` \| [`ConferenceChange`](ConferenceChange.md) | - |
| <a id="property-description"></a> `description?` | `string` \| `null` | Optional event body. |
| <a id="property-emaillinkid"></a> `emailLinkId?` | `string` \| `null` | Connected inbox whose primary calendar receives the event; defaults to the requester's primary inbox. |
| <a id="property-idempotencykey"></a> `idempotencyKey?` | `string` \| `null` | Stable retry identity, scoped to the authenticated organizer. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Optional location label. |
| <a id="property-outofoffice"></a> `outOfOffice?` | `null` \| [`OutOfOfficeProperties`](OutOfOfficeProperties.md) | - |
| <a id="property-recurrencelines"></a> `recurrenceLines?` | `string`[] | Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`). |
| <a id="property-reminders"></a> `reminders?` | `null` \| [`EventReminders`](EventReminders.md) | - |
| <a id="property-time"></a> `time` | [`EventTime`](EventTime.md) | Timed or all-day shape. |
| <a id="property-title"></a> `title` | `string` | Display title. |
| <a id="property-transparency"></a> `transparency?` | `null` \| [`EventTransparency`](EventTransparency.md) | - |
| <a id="property-visibility"></a> `visibility?` | `null` \| [`EventVisibility`](EventVisibility.md) | - |
