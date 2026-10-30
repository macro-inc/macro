# Type Alias: InviteCalendarEventGuestsErrors

> **InviteCalendarEventGuestsErrors** = \{ `400`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `401`: `unknown`; `403`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `404`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `409`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `503`: [`CalendarMutationApiError`](CalendarMutationApiError.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Invalid guests or scope |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-403"></a> `403` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Calendar is read-only, only the organizer can invite guests, the event is a snapshot of a shared meeting, or the calendar needs reauthorization |
| <a id="property-404"></a> `404` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Event or occurrence not found |
| <a id="property-409"></a> `409` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | The connected account neither organizes nor attends the event |
| <a id="property-503"></a> `503` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Transient provider failure |
