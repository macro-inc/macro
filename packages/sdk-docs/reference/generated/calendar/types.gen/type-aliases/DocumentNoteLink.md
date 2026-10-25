# Type Alias: DocumentNoteLink

> **DocumentNoteLink** = \{ `documentName`: `string`; `eventId`: `string`; `eventTitle`: `string`; `occurrenceKey`: `string`; `team?`: `null` \| [`NoteTeam`](NoteTeam.md); \}

An owner's durable sharing link, including meetings they can no longer open.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-documentname"></a> `documentName` | `string` | Current name of the owned markdown document. |
| <a id="property-eventid"></a> `eventId` | `string` | Linked calendar copy. |
| <a id="property-eventtitle"></a> `eventTitle` | `string` | Current title, or a safe placeholder when meeting details are unavailable. |
| <a id="property-occurrencekey"></a> `occurrenceKey` | `string` | Original occurrence start, or `single` for a one-time meeting. |
| <a id="property-team"></a> `team?` | `null` \| [`NoteTeam`](NoteTeam.md) | - |
