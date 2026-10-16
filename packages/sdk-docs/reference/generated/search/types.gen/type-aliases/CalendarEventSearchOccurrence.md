# Type Alias: CalendarEventSearchOccurrence

> **CalendarEventSearchOccurrence** = \{ `occurrenceKey`: `string`; `time`: [`CalendarEventSearchTime`](CalendarEventSearchTime.md); \}

The instance a search row points at.

A recurring series is indexed once, as its master. Which instance the row
should show is decided per request rather than baked into the index: the
next occurrence at or after now, else the most recent past one. This is
the same resolution a calendar mention performs, so a search row and a
mention of the same event agree on where they land.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-occurrencekey"></a> `occurrenceKey` | `string` | Stable key of the resolved instance within its series. |
| <a id="property-time"></a> `time` | [`CalendarEventSearchTime`](CalendarEventSearchTime.md) | Span of the resolved instance. |
