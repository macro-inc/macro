# Type Alias: RsvpCalendarEventRequest

> **RsvpCalendarEventRequest** = \{ `calendarId?`: `string` \| `null`; `recurrenceId?`: `string` \| `null`; `respondingEmail?`: `string` \| `null`; `response`: [`AttendeeResponseStatus`](AttendeeResponseStatus.md); `scope?`: `null` \| [`CalendarRsvpScopeParam`](CalendarRsvpScopeParam.md); \}

Request body setting the requester's RSVP on an event.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendarid"></a> `calendarId?` | `string` \| `null` | Calendar whose copy of the event is answered, for an event synced from more than one calendar. Omit to answer on the canonical copy. |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` \| `null` | Original-start key of the occurrence the response targets. |
| <a id="property-respondingemail"></a> `respondingEmail?` | `string` \| `null` | The owned connected address whose attendance is changed. Validated by the domain. |
| <a id="property-response"></a> `response` | [`AttendeeResponseStatus`](AttendeeResponseStatus.md) | The response to record for the connected account. |
| <a id="property-scope"></a> `scope?` | `null` \| [`CalendarRsvpScopeParam`](CalendarRsvpScopeParam.md) | - |
