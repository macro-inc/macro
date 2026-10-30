# Type Alias: RequestToJoinErrors

> **RequestToJoinErrors** = \{ `401`: `unknown`; `404`: [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md); `409`: [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md); `500`: [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-404"></a> `404` | [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md) | Event not found or not shared with the requester |
| <a id="property-409"></a> `409` | [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md) | Already on the requester's calendar, the sharer cannot add guests, or the sharer declined the requester's earlier request |
| <a id="property-500"></a> `500` | [`CalendarJoinRequestApiError`](CalendarJoinRequestApiError.md) | Join request failed |
