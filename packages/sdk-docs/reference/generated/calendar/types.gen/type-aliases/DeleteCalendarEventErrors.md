# Type Alias: DeleteCalendarEventErrors

> **DeleteCalendarEventErrors** = \{ `401`: `unknown`; `403`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `404`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `409`: [`CalendarMutationApiError`](CalendarMutationApiError.md); `503`: [`CalendarMutationApiError`](CalendarMutationApiError.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-403"></a> `403` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Calendar is read-only or needs reauthorization |
| <a id="property-404"></a> `404` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Event not found |
| <a id="property-409"></a> `409` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | The provider rejected the deletion |
| <a id="property-503"></a> `503` | [`CalendarMutationApiError`](CalendarMutationApiError.md) | Transient provider failure |
