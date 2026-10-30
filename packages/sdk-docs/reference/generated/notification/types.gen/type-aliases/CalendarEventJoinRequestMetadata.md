# Type Alias: CalendarEventJoinRequestMetadata

> **CalendarEventJoinRequestMetadata** = \{ `eventId`: `string`; `requestId`: `string`; `title`: `string`; \}

A channel member who sees a calendar event only through a channel share
asked the person who shared it to add them as a guest. Sent to the sharer,
with the requester as sender.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-eventid"></a> `eventId` | `string` | The shared calendar event entity the request is for. |
| <a id="property-requestid"></a> `requestId` | `string` | Stable request identity, answered from the event's details. |
| <a id="property-title"></a> `title` | `string` | Event title when the request was made. |
