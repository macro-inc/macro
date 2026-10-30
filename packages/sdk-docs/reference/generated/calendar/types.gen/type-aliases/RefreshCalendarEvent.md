# Type Alias: RefreshCalendarEvent

> **RefreshCalendarEvent** = \{ `event`: `"synced"`; `link_id`: `string`; `team_ooo_changed`: `boolean`; \} \| \{ `event`: `"team_sharing_changed"`; `team_ooo_changed`: `boolean`; \}

Realtime signal that a connected inbox's calendar projection changed.

## Union Members

### Type Literal

\{ `event`: `"synced"`; `link_id`: `string`; `team_ooo_changed`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event` | `"synced"` | - |
| `link_id` | `string` | Connected inbox whose calendars changed. |
| `team_ooo_changed` | `boolean` | False only when the run excludes changes to teammate OOO projections. |

***

### Type Literal

\{ `event`: `"team_sharing_changed"`; `team_ooo_changed`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event` | `"team_sharing_changed"` | - |
| `team_ooo_changed` | `boolean` | True for sharing changes and any possibly affected OOO projection. |
