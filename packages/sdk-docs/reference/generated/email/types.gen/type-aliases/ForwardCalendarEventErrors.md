# Type Alias: ForwardCalendarEventErrors

> **ForwardCalendarEventErrors** = \{ `400`: [`ForwardCalendarEventError`](ForwardCalendarEventError.md); `401`: `unknown`; `403`: [`ForwardCalendarEventError`](ForwardCalendarEventError.md); `404`: [`ForwardCalendarEventError`](ForwardCalendarEventError.md); `502`: [`ForwardCalendarEventError`](ForwardCalendarEventError.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`ForwardCalendarEventError`](ForwardCalendarEventError.md) | No, too many, or invalid recipients |
| <a id="property-401"></a> `401` | `unknown` | Authentication required |
| <a id="property-403"></a> `403` | [`ForwardCalendarEventError`](ForwardCalendarEventError.md) | The inbox holding the copy cannot send for the viewer |
| <a id="property-404"></a> `404` | [`ForwardCalendarEventError`](ForwardCalendarEventError.md) | No such event on one of the viewer's own inboxes |
| <a id="property-502"></a> `502` | [`ForwardCalendarEventError`](ForwardCalendarEventError.md) | The email could not be sent |
