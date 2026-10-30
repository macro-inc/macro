# Type Alias: TeamCalendarContent

> **TeamCalendarContent** = \{ `kind`: `"busy"`; \} \| \{ `details`: [`TeamCalendarDetails`](TeamCalendarDetails.md); `kind`: `"details"`; \}

Disjoint busy/detail shapes prevent new event fields leaking by default.

## Union Members

### Type Literal

\{ `kind`: `"busy"`; \}

***

### Type Literal

\{ `details`: [`TeamCalendarDetails`](TeamCalendarDetails.md); `kind`: `"details"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `details` | [`TeamCalendarDetails`](TeamCalendarDetails.md) | Detail projection. |
| `kind` | `"details"` | - |
