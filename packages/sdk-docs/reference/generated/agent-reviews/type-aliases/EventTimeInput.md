# Type Alias: EventTimeInput

> **EventTimeInput** = \{ `endsAt`: `string`; `kind`: `"timed"`; `startsAt`: `string`; `timeZone?`: `string` \| `null`; \} \| \{ `endDate`: `string`; `kind`: `"allDay"`; `startDate`: `string`; \}

The mutually exclusive time shape supplied to calendar tools.

## Union Members

### Type Literal

\{ `endsAt`: `string`; `kind`: `"timed"`; `startsAt`: `string`; `timeZone?`: `string` \| `null`; \}

A clock-time event with absolute instants.

| Name | Type | Description |
| ------ | ------ | ------ |
| `endsAt` | `string` | Exclusive end instant, RFC 3339 UTC. Must be after the start. |
| `kind` | `"timed"` | - |
| `startsAt` | `string` | Inclusive start instant, RFC 3339 UTC (e.g. 2026-08-20T17:00:00Z). |
| `timeZone?` | `string` \| `null` | IANA time zone the event was scheduled in (e.g. America/New_York). Recurring events expand in this zone. |

***

### Type Literal

\{ `endDate`: `string`; `kind`: `"allDay"`; `startDate`: `string`; \}

An all-day event spanning whole local dates.

| Name | Type | Description |
| ------ | ------ | ------ |
| `endDate` | `string` | Exclusive local end date (YYYY-MM-DD); the day after the last covered day, so a one-day event ends the next date. |
| `kind` | `"allDay"` | - |
| `startDate` | `string` | Inclusive local start date (YYYY-MM-DD). |
