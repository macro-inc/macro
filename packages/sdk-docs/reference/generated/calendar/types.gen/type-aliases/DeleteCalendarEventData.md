# Type Alias: DeleteCalendarEventData

> **DeleteCalendarEventData** = \{ `body?`: `never`; `path`: \{ `event_id`: `string`; \}; `query?`: \{ `calendarId?`: `string`; `recurrenceId?`: `string`; `scope?`: [`CalendarDeletionScopeParam`](CalendarDeletionScopeParam.md); \}; `url`: `"/events/{event_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `event_id`: `string`; \} | - |
| `path.event_id` | `string` | Calendar event entity id |
| <a id="property-query"></a> `query?` | \{ `calendarId?`: `string`; `recurrenceId?`: `string`; `scope?`: [`CalendarDeletionScopeParam`](CalendarDeletionScopeParam.md); \} | - |
| `query.calendarId?` | `string` | Calendar whose copy of the event is deleted, for an event synced from more than one calendar. Omit to delete the canonical copy. |
| `query.recurrenceId?` | `string` | Original-start key of the occurrence a scoped deletion targets. |
| `query.scope?` | [`CalendarDeletionScopeParam`](CalendarDeletionScopeParam.md) | Deletion scope; defaults to the entire event or series. |
| <a id="property-url"></a> `url` | `"/events/{event_id}"` | - |
