# Type Alias: UpdateCalendarEventRequest

> **UpdateCalendarEventRequest** = \{ `attendees?`: [`CalendarAttendeeInputBody`](CalendarAttendeeInputBody.md)[] \| `null`; `calendarId?`: `string` \| `null`; `conference?`: `null` \| [`ConferenceChange`](ConferenceChange.md); `description?`: `string` \| `null`; `location?`: `string` \| `null`; `outOfOffice?`: `null` \| [`OutOfOfficeProperties`](OutOfOfficeProperties.md); `recurrenceId?`: `string` \| `null`; `recurrenceLines?`: `string`[] \| `null`; `reminders?`: `null` \| [`EventReminders`](EventReminders.md); `scope?`: `null` \| [`CalendarUpdateScopeParam`](CalendarUpdateScopeParam.md); `time?`: `null` \| [`EventTime`](EventTime.md); `title?`: `string` \| `null`; `transparency?`: `null` \| [`EventTransparency`](EventTransparency.md); `visibility?`: `null` \| [`EventVisibility`](EventVisibility.md); \}

Request body patching an event; omitted fields are left untouched.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees?` | [`CalendarAttendeeInputBody`](CalendarAttendeeInputBody.md)[] \| `null` | Replacement attendee list. |
| <a id="property-calendarid"></a> `calendarId?` | `string` \| `null` | Calendar whose copy of the event is patched, for an event synced from more than one calendar. Omit to patch the canonical copy. |
| <a id="property-conference"></a> `conference?` | `null` \| [`ConferenceChange`](ConferenceChange.md) | - |
| <a id="property-description"></a> `description?` | `string` \| `null` | Replacement description; an empty string clears it. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Replacement location; an empty string clears it. |
| <a id="property-outofoffice"></a> `outOfOffice?` | `null` \| [`OutOfOfficeProperties`](OutOfOfficeProperties.md) | - |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` \| `null` | Original-start key of the occurrence the update targets. |
| <a id="property-recurrencelines"></a> `recurrenceLines?` | `string`[] \| `null` | Replacement recurrence properties; an empty list clears them. |
| <a id="property-reminders"></a> `reminders?` | `null` \| [`EventReminders`](EventReminders.md) | - |
| <a id="property-scope"></a> `scope?` | `null` \| [`CalendarUpdateScopeParam`](CalendarUpdateScopeParam.md) | - |
| <a id="property-time"></a> `time?` | `null` \| [`EventTime`](EventTime.md) | - |
| <a id="property-title"></a> `title?` | `string` \| `null` | Replacement title; an empty string clears it. |
| <a id="property-transparency"></a> `transparency?` | `null` \| [`EventTransparency`](EventTransparency.md) | - |
| <a id="property-visibility"></a> `visibility?` | `null` \| [`EventVisibility`](EventVisibility.md) | - |
