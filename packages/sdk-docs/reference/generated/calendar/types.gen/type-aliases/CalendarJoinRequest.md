# Type Alias: CalendarJoinRequest

> **CalendarJoinRequest** = \{ `createdAt`: `string`; `eventId`: `string`; `id`: `string`; `requesterEmail`: `string`; `requesterId`: `string`; `status`: [`CalendarJoinRequestStatus`](CalendarJoinRequestStatus.md); \}

A channel member's request to be added as a guest of an event they see
only through a channel share.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When the request was made. |
| <a id="property-eventid"></a> `eventId` | `string` | The sharer's event entity that was shared with the channel. |
| <a id="property-id"></a> `id` | `string` | Request identifier. |
| <a id="property-requesteremail"></a> `requesterEmail` | `string` | Address the sharer invites when accepting. |
| <a id="property-requesterid"></a> `requesterId` | `string` | Macro user asking to join. |
| <a id="property-status"></a> `status` | [`CalendarJoinRequestStatus`](CalendarJoinRequestStatus.md) | Where the request stands. |
