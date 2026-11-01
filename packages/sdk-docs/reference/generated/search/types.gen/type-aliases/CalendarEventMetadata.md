# Type Alias: CalendarEventMetadata

> **CalendarEventMetadata** = \{ `calendarName?`: `string` \| `null`; `conferenceUrl?`: `string` \| `null`; `contributesToAvailability?`: `boolean` \| `null`; `createdAt`: `string`; `description?`: `string` \| `null`; `inbox?`: `string` \| `null`; `isReadOnly`: `boolean`; `isRecurring`: `boolean`; `occurrence?`: `null` \| [`CalendarEventSearchOccurrence`](CalendarEventSearchOccurrence.md); `organizer?`: `null` \| [`CalendarEventOrganizer`](CalendarEventOrganizer.md); `role?`: `null` \| [`CalendarEventSearchRole`](CalendarEventSearchRole.md); `status`: `string`; `time`: [`CalendarEventSearchTime`](CalendarEventSearchTime.md); `updatedAt`: `string`; \}

Metadata for a calendar event fetched from the database.

The index carries the master span for ranking, but the occurrence a row
should display depends on when the query ran, so it is resolved here
rather than indexed.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-calendarname"></a> `calendarName?` | `string` \| `null` | Display name of the calendar holding this copy. Absent on an event shared with the user, which is on none of their calendars. |
| <a id="property-conferenceurl"></a> `conferenceUrl?` | `string` \| `null` | Direct conference join URL when known. |
| <a id="property-contributestoavailability"></a> `contributesToAvailability?` | `boolean` \| `null` | Whether a calendar holding this copy is on the user's schedule. The user can see calendars that are not theirs, such as a colleague's: a row without this, and that they do not attend, says what that calendar shows, not where the user is. |
| <a id="property-createdat"></a> `createdAt` | `string` | - |
| <a id="property-description"></a> `description?` | `string` \| `null` | Free-text description, when the event carries one. May contain HTML from the source; clients render a plain-text preview. |
| <a id="property-inbox"></a> `inbox?` | `string` \| `null` | The connected inbox syncing that calendar. It stays the user's own address on a colleague's calendar, so it never says whose calendar it is. |
| <a id="property-isreadonly"></a> `isReadOnly` | `boolean` | Whether the canonical source prohibits mutation. |
| <a id="property-isrecurring"></a> `isRecurring` | `boolean` | Whether the series carries a recurrence rule. Lets a row render a recurring badge without parsing the rules. |
| <a id="property-occurrence"></a> `occurrence?` | `null` \| [`CalendarEventSearchOccurrence`](CalendarEventSearchOccurrence.md) | - |
| <a id="property-organizer"></a> `organizer?` | `null` \| [`CalendarEventOrganizer`](CalendarEventOrganizer.md) | - |
| <a id="property-role"></a> `role?` | `null` \| [`CalendarEventSearchRole`](CalendarEventSearchRole.md) | - |
| <a id="property-status"></a> `status` | `string` | Canonical status (`confirmed`, `tentative`, `cancelled`). |
| <a id="property-time"></a> `time` | [`CalendarEventSearchTime`](CalendarEventSearchTime.md) | The series' own span. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | - |
