# Type Alias: CreateCalendarEventErrors

> **CreateCalendarEventErrors** = \{ `400`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `401`: `unknown`; `403`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `409`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `503`: [`CalendarMutationApiError`](CalendarMutationApiError.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Invalid event fields |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-403"></a> `403` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Calendar is read-only or needs reauthorization |
| <a id="property-409"></a> `409` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | No writable calendar or the provider rejected the event |
| <a id="property-503"></a> `503` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Transient provider failure |
