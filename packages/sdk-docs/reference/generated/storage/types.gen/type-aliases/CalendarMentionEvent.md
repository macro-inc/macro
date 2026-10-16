# Type Alias: CalendarMentionEvent

> **CalendarMentionEvent** = \{ `attendeeCount`: `number`; `description?`: `string` \| `null`; `isRecurring`: `boolean`; `location?`: `string` \| `null`; `occurrenceKey?`: `string` \| `null`; `organizerEmail?`: `string` \| `null`; `organizerName?`: `string` \| `null`; `time`: [`EventTime`](EventTime.md); `title`: `string`; `updatedAt`: `string`; `viewerEventId?`: `string` \| `null`; \}

Meeting-level fields shown in a calendar event mention preview, taken from
the requester's own projection of the meeting, or — when the requester has
none — from the mentioned projection a channel they belong to was given.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendeecount"></a> `attendeeCount` | `number` | Number of attendees on the previewed copy. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Provider description, plain text or HTML, truncated for the preview. Clients must sanitize it before rendering. |
| <a id="property-isrecurring"></a> `isRecurring` | `boolean` | Whether the event repeats. |
| <a id="property-location"></a> `location?` | `string` \| `null` | Location label, when set. |
| <a id="property-occurrencekey"></a> `occurrenceKey?` | `string` \| `null` | Key of the previewed instance, absent when no occurrence is materialized. |
| <a id="property-organizeremail"></a> `organizerEmail?` | `string` \| `null` | Organizer email. |
| <a id="property-organizername"></a> `organizerName?` | `string` \| `null` | Organizer display name. |
| <a id="property-time"></a> `time` | [`EventTime`](EventTime.md) | Time of the previewed instance: the requested occurrence when it exists, else the next upcoming one, else the latest past one, else the series start. |
| <a id="property-title"></a> `title` | `string` | Display title. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Entity update time of the previewed copy. |
| <a id="property-viewereventid"></a> `viewerEventId?` | `string` \| `null` | The requester's own event entity for the mentioned meeting. Differs from the mentioned id when the mention came from another attendee. Absent when the meeting is on none of the requester's calendars and they see it only because it was shared with one of their channels: that preview is read-only and there is no event of theirs to open. |
