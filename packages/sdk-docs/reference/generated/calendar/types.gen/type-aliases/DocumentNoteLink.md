# Type Alias: DocumentNoteLink

> **DocumentNoteLink** = \{ `canViewMeeting`: `boolean`; `documentName`: `string`; `event?`: `null` \| [`CalendarMentionEvent`](CalendarMentionEvent.md); `eventId`: `string`; `eventTitle`: `string`; `occurrenceKey`: `string`; `team?`: `null` \| [`NoteTeam`](NoteTeam.md); `teamEvent?`: `null` \| [`TeamCalendarItem`](TeamCalendarItem.md); \}

A visible meeting link, or an owner's durable grant they can no longer open.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-canviewmeeting"></a> `canViewMeeting` | `boolean` | Whether the reader may resolve this exact meeting's details right now. |
| <a id="property-documentname"></a> `documentName` | `string` | Current name of the markdown document. |
| <a id="property-event"></a> `event?` | `null` \| [`CalendarMentionEvent`](CalendarMentionEvent.md) | - |
| <a id="property-eventid"></a> `eventId` | `string` | Linked calendar copy. |
| <a id="property-eventtitle"></a> `eventTitle` | `string` | Current title, or a safe placeholder when meeting details are unavailable. |
| <a id="property-occurrencekey"></a> `occurrenceKey` | `string` | Original occurrence start, or `single` for a one-time meeting. |
| <a id="property-team"></a> `team?` | `null` \| [`NoteTeam`](NoteTeam.md) | - |
| <a id="property-teamevent"></a> `teamEvent?` | `null` \| [`TeamCalendarItem`](TeamCalendarItem.md) | - |
