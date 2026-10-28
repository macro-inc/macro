# Type Alias: UnlinkEventNoteData

> **UnlinkEventNoteData** = \{ `body?`: `never`; `path`: \{ `document_id`: `string`; `event_id`: `string`; \}; `query`: \{ `occurrenceKey`: `string`; \}; `url`: `"/events/{event_id}/notes/{document_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `document_id`: `string`; `event_id`: `string`; \} | - |
| `path.document_id` | `string` | - |
| `path.event_id` | `string` | - |
| <a id="property-query"></a> `query` | \{ `occurrenceKey`: `string`; \} | - |
| `query.occurrenceKey` | `string` | Stable occurrence key returned by the calendar read API. |
| <a id="property-url"></a> `url` | `"/events/{event_id}/notes/{document_id}"` | - |
