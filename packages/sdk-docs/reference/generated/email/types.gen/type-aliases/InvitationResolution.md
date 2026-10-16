# Type Alias: InvitationResolution

> **InvitationResolution** = \{ `kind`: `"disconnected"`; \} \| \{ `kind`: `"still_syncing"`; \} \| \{ `kind`: `"cancelled"`; \} \| \{ `kind`: `"unavailable"`; \} \| \{ `kind`: `"no_match"`; \} \| \{ `kind`: `"ambiguous"`; \} \| \{ `can_join`: `boolean`; `can_respond`: `boolean`; `event`: [`CalendarEvent`](CalendarEvent.md); `is_stale`: `boolean`; `kind`: `"resolved"`; `occurrence`: [`CalendarOccurrence`](CalendarOccurrence.md); `responding_email`: `string`; \}

Refreshable result, distinct from the immutable email contents.

## Union Members

### Type Literal

\{ `kind`: `"disconnected"`; \}

***

### Type Literal

\{ `kind`: `"still_syncing"`; \}

***

### Type Literal

\{ `kind`: `"cancelled"`; \}

***

### Type Literal

\{ `kind`: `"unavailable"`; \}

***

### Type Literal

\{ `kind`: `"no_match"`; \}

***

### Type Literal

\{ `kind`: `"ambiguous"`; \}

***

### Type Literal

\{ `can_join`: `boolean`; `can_respond`: `boolean`; `event`: [`CalendarEvent`](CalendarEvent.md); `is_stale`: `boolean`; `kind`: `"resolved"`; `occurrence`: [`CalendarOccurrence`](CalendarOccurrence.md); `responding_email`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `can_join` | `boolean` | Whether the conference link belongs to the reconciled scheduling target. |
| `can_respond` | `boolean` | Whether a response is currently allowed. |
| `event` | [`CalendarEvent`](CalendarEvent.md) | Current occurrence-specific content. |
| `is_stale` | `boolean` | Whether the provider projection trails the email revision. |
| `kind` | `"resolved"` | - |
| `occurrence` | [`CalendarOccurrence`](CalendarOccurrence.md) | Original occurrence identity and current time. |
| `responding_email` | `string` | Connected address that would respond. |
