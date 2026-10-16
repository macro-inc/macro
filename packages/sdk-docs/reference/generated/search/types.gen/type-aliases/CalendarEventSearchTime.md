# Type Alias: CalendarEventSearchTime

> **CalendarEventSearchTime** = \{ `endsAt`: `string`; `kind`: `"timed"`; `startsAt`: `string`; `timeZone?`: `string` \| `null`; \} \| \{ `endDate`: `string`; `kind`: `"allDay"`; `startDate`: `string`; \}

Timed or all-day span of a calendar event.

Deliberately a local mirror of `models_soup::calendar_event::SoupCalendarEventTime`
rather than a reuse of it: this module needs both `ToSchema` (OpenAPI) and
`JsonSchema` (AI tool schemas), and `models_soup` carries no schemars
dependency. The wire shape is identical and must stay that way, so a
client can decode a search row and a soup row with one mapping.

Fields are camelCased per variant rather than via `rename_all_fields`,
which utoipa ignores.

## Union Members

### Type Literal

\{ `endsAt`: `string`; `kind`: `"timed"`; `startsAt`: `string`; `timeZone?`: `string` \| `null`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `endsAt` | `string` | Exclusive end. |
| `kind` | `"timed"` | - |
| `startsAt` | `string` | Inclusive start. |
| `timeZone?` | `string` \| `null` | Original IANA time zone. |

***

### Type Literal

\{ `endDate`: `string`; `kind`: `"allDay"`; `startDate`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `endDate` | `string` | Exclusive end date. |
| `kind` | `"allDay"` | - |
| `startDate` | `string` | Inclusive start date. |
