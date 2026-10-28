# Type Alias: CalendarOccurrence

> **CalendarOccurrence** = \{ `eventId`: `string`; `isCancelled`: `boolean`; `occurrenceKey`: `string`; `recurrenceId?`: `string` \| `null`; `time`: [`EventTime`](EventTime.md); \}

A materialized recurrence instance optimized for range queries.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-eventid"></a> `eventId` | `string` | Owning event entity. |
| <a id="property-iscancelled"></a> `isCancelled` | `boolean` | Whether the instance was cancelled. |
| <a id="property-occurrencekey"></a> `occurrenceKey` | `string` | Stable key within the event. |
| <a id="property-recurrenceid"></a> `recurrenceId?` | `string` \| `null` | Provider recurrence identifier, when applicable. |
| <a id="property-time"></a> `time` | [`EventTime`](EventTime.md) | Instance time. |
