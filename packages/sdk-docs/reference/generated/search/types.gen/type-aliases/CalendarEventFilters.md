# Type Alias: CalendarEventFilters

> **CalendarEventFilters** = \{ `attendees?`: `string`[]; `calendar_event_ids?`: `string`[]; `ends_after?`: `string` \| `null`; `organizers?`: `string`[]; `starts_before?`: `string` \| `null`; `statuses?`: `string`[]; \}

Filters for canonical calendar-event entities.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attendees"></a> `attendees?` | `string`[] | Attendee email addresses. |
| <a id="property-calendar_event_ids"></a> `calendar_event_ids?` | `string`[] | Canonical event ids. |
| <a id="property-ends_after"></a> `ends_after?` | `string` \| `null` | Include master events ending after this instant. |
| <a id="property-organizers"></a> `organizers?` | `string`[] | Organizer email addresses. |
| <a id="property-starts_before"></a> `starts_before?` | `string` \| `null` | Include master events starting before this instant. |
| <a id="property-statuses"></a> `statuses?` | `string`[] | Event statuses such as `confirmed`, `tentative`, or `cancelled`. |
