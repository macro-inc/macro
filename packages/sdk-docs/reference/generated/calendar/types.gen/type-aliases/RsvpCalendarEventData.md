# Type Alias: RsvpCalendarEventData

> **RsvpCalendarEventData** = \{ `body`: [`RsvpCalendarEventRequest`](RsvpCalendarEventRequest.md); `path`: \{ `event_id`: `string`; \}; `query?`: `never`; `url`: `"/events/{event_id}/rsvp"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`RsvpCalendarEventRequest`](RsvpCalendarEventRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `event_id`: `string`; \} | - |
| `path.event_id` | `string` | Calendar event entity id |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/events/{event_id}/rsvp"` | - |
