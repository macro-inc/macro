# Type Alias: TeamOutOfOfficeItem

> **TeamOutOfOfficeItem** = \{ `eventId`: `string`; `occurrenceKey`: `string`; `ownerId`: `string`; `time`: [`EventTime`](EventTime.md); `title?`: `string` \| `null`; \}

One teammate's out-of-office occurrence.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-eventid"></a> `eventId` | `string` | The teammate's calendar event id. |
| <a id="property-occurrencekey"></a> `occurrenceKey` | `string` | Stable occurrence key within the event. |
| <a id="property-ownerid"></a> `ownerId` | `string` | Macro user id of the teammate who is out. |
| <a id="property-time"></a> `time` | [`EventTime`](EventTime.md) | Occurrence time span. |
| <a id="property-title"></a> `title?` | `string` \| `null` | Event title, absent unless the teammate shares event details. |
