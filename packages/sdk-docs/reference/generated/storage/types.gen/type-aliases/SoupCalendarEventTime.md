# Type Alias: SoupCalendarEventTime

> **SoupCalendarEventTime** = \{ `endsAt`: `string`; `kind`: `"timed"`; `startsAt`: `string`; `timeZone?`: `string` \| `null`; \} \| \{ `endDate`: `string`; `kind`: `"allDay"`; `startDate`: `string`; \}

Timed or all-day calendar event span.

Fields are camelCased per variant rather than via `rename_all_fields`,
which utoipa ignores — the generated OpenAPI schema would otherwise
claim snake_case fields the wire never carries.

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
