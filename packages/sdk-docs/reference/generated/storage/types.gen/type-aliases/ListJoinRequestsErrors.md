# Type Alias: ListJoinRequestsErrors

> **ListJoinRequestsErrors** = \{ `401`: `unknown`; `404`: [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md); `500`: [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-404"></a> `404` | [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md) | Event not found or not editable by the requester |
| <a id="property-500"></a> `500` | [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md) | Listing failed |
