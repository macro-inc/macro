# Type Alias: TeamCalendarItem

> **TeamCalendarItem** = [`TeamCalendarContent`](TeamCalendarContent.md) & \{ `contributesToAvailability`: `boolean`; `id`: `string`; `ownerId`: `string`; `time`: [`EventTime`](EventTime.md); \}

A read-only team calendar occurrence.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `contributesToAvailability` | `boolean` | Whether this occurrence blocks the sharer's personal availability. A subscribed calendar's block can be shared without occupying the sharer. |
| `id` | `string` | Stable opaque projection identity, never an event entity id. |
| `ownerId` | `string` | The person sharing access to the source. |
| `time` | [`EventTime`](EventTime.md) | Occurrence interval. |
