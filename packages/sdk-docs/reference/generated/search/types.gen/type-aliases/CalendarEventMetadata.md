# Type Alias: CalendarEventMetadata

> **CalendarEventMetadata** = \{ `conferenceUrl?`: `string` \| `null`; `createdAt`: `string`; `description?`: `string` \| `null`; `isReadOnly`: `boolean`; `isRecurring`: `boolean`; `occurrence?`: `null` \| [`CalendarEventSearchOccurrence`](CalendarEventSearchOccurrence.md); `organizer?`: `null` \| [`CalendarEventOrganizer`](CalendarEventOrganizer.md); `status`: `string`; `time`: [`CalendarEventSearchTime`](CalendarEventSearchTime.md); `updatedAt`: `string`; \}

Metadata for a calendar event fetched from the database.

The index carries the master span for ranking, but the occurrence a row
should display depends on when the query ran, so it is resolved here
rather than indexed.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-conferenceurl"></a> `conferenceUrl?` | `string` \| `null` | Direct conference join URL when known. |
| <a id="property-createdat"></a> `createdAt` | `string` | - |
| <a id="property-description"></a> `description?` | `string` \| `null` | Free-text description, when the event carries one. May contain HTML from the source; clients render a plain-text preview. |
| <a id="property-isreadonly"></a> `isReadOnly` | `boolean` | Whether the canonical source prohibits mutation. |
| <a id="property-isrecurring"></a> `isRecurring` | `boolean` | Whether the series carries a recurrence rule. Lets a row render a recurring badge without parsing the rules. |
| <a id="property-occurrence"></a> `occurrence?` | `null` \| [`CalendarEventSearchOccurrence`](CalendarEventSearchOccurrence.md) | - |
| <a id="property-organizer"></a> `organizer?` | `null` \| [`CalendarEventOrganizer`](CalendarEventOrganizer.md) | - |
| <a id="property-status"></a> `status` | `string` | Canonical status (`confirmed`, `tentative`, `cancelled`). |
| <a id="property-time"></a> `time` | [`CalendarEventSearchTime`](CalendarEventSearchTime.md) | The series' own span. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | - |
