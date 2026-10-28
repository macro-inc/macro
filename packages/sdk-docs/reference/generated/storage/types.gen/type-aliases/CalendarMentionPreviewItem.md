# Type Alias: CalendarMentionPreviewItem

> **CalendarMentionPreviewItem** = \{ `event?`: `null` \| [`CalendarMentionEvent`](CalendarMentionEvent.md); `eventId`: `string`; `type`: [`CalendarMentionPreviewKind`](CalendarMentionPreviewKind.md); \}

Resolution of one mentioned event, in request order.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-event"></a> `event?` | `null` \| [`CalendarMentionEvent`](CalendarMentionEvent.md) | - |
| <a id="property-eventid"></a> `eventId` | `string` | The mentioned event id, echoed from the request. |
| <a id="property-type"></a> `type` | [`CalendarMentionPreviewKind`](CalendarMentionPreviewKind.md) | Visibility of the mentioned event to the requester. |
