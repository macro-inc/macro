# Type Alias: ListTeamCalendarData

> **ListTeamCalendarData** = \{ `body?`: `never`; `path?`: `never`; `query`: \{ `cursor?`: `string` \| `null`; `end`: `string`; `limit?`: `number` \| `null`; `start`: `string`; \}; `url`: `"/calendar-events/team"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query` | \{ `cursor?`: `string` \| `null`; `end`: `string`; `limit?`: `number` \| `null`; `start`: `string`; \} | - |
| `query.cursor?` | `string` \| `null` | Continuation returned by the preceding page. |
| `query.end` | `string` | Exclusive instant. |
| `query.limit?` | `number` \| `null` | Maximum source occurrences, at most 2,000. Zero returns the roster only. |
| `query.start` | `string` | Inclusive instant. |
| <a id="property-url"></a> `url` | `"/calendar-events/team"` | - |
