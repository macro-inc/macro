# Type Alias: ForwardCalendarEventData

> **ForwardCalendarEventData** = \{ `body`: [`ForwardCalendarEventRequest`](ForwardCalendarEventRequest.md); `path`: \{ `event_id`: `string`; \}; `query?`: `never`; `url`: `"/email/calendar-events/{event_id}/forward"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`ForwardCalendarEventRequest`](ForwardCalendarEventRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `event_id`: `string`; \} | - |
| `path.event_id` | `string` | The viewer's copy of the event |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/email/calendar-events/{event_id}/forward"` | - |
