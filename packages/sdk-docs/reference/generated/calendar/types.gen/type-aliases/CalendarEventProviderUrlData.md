# Type Alias: CalendarEventProviderUrlData

> **CalendarEventProviderUrlData** = \{ `body?`: `never`; `path`: \{ `event_id`: `string`; \}; `query?`: \{ `calendarId?`: `string` \| `null`; `recurrenceId?`: `string` \| `null`; \}; `url`: `"/events/{event_id}/provider-url"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `event_id`: `string`; \} | - |
| `path.event_id` | `string` | - |
| <a id="property-query"></a> `query?` | \{ `calendarId?`: `string` \| `null`; `recurrenceId?`: `string` \| `null`; \} | - |
| `query.calendarId?` | `string` \| `null` | Exact calendar copy; defaults to the canonical copy. |
| `query.recurrenceId?` | `string` \| `null` | Original-start key of one occurrence; omitted for the entire series. |
| <a id="property-url"></a> `url` | `"/events/{event_id}/provider-url"` | - |
