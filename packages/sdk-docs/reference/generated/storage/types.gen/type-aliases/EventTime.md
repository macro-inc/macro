# Type Alias: EventTime

> **EventTime** = \{ `endsAt`: `string`; `kind`: `"timed"`; `startsAt`: `string`; `timeZone?`: `string` \| `null`; \} \| \{ `endDate`: `string`; `kind`: `"allDay"`; `startDate`: `string`; \}

The mutually exclusive time shape of a calendar event.

Fields are renamed per variant rather than with `rename_all_fields`
because utoipa only honors variant-level serde renames when it
derives the OpenAPI schema.

## Union Members

### Type Literal

\{ `endsAt`: `string`; `kind`: `"timed"`; `startsAt`: `string`; `timeZone?`: `string` \| `null`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `endsAt` | `string` | Exclusive end instant; equal to the start for an imported point event. |
| `kind` | `"timed"` | - |
| `startsAt` | `string` | Inclusive start instant. |
| `timeZone?` | `string` \| `null` | Original IANA time-zone identifier, when supplied. |

***

### Type Literal

\{ `endDate`: `string`; `kind`: `"allDay"`; `startDate`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `endDate` | `string` | Exclusive local end date. |
| `kind` | `"allDay"` | - |
| `startDate` | `string` | Inclusive local start date. |
