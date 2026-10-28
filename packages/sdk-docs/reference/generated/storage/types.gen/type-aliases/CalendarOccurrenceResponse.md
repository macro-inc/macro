# Type Alias: CalendarOccurrenceResponse

> **CalendarOccurrenceResponse** = \{ `hasMore`: `boolean`; `items`: [`CalendarOccurrenceItem`](CalendarOccurrenceItem.md)[]; `nextCursor?`: `string` \| `null`; `syncStatus`: [`CalendarSyncStatus`](CalendarSyncStatus.md); \}

Paginated calendar occurrence viewport response.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-hasmore"></a> `hasMore` | `boolean` | - |
| <a id="property-items"></a> `items` | [`CalendarOccurrenceItem`](CalendarOccurrenceItem.md)[] | - |
| <a id="property-nextcursor"></a> `nextCursor?` | `string` \| `null` | - |
| <a id="property-syncstatus"></a> `syncStatus` | [`CalendarSyncStatus`](CalendarSyncStatus.md) | Aggregate ingestion state; clients render a skeleton while `syncing`. |
