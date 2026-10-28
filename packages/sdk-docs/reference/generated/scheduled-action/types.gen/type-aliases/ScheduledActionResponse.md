# Type Alias: ScheduledActionResponse

> **ScheduledActionResponse** = [`ScheduledAction`](ScheduledAction.md) & \{ `schedule?`: `string` \| `null`; `timezone?`: `string` \| `null`; \}

Canonical trigger plus deprecated cron fields for existing clients. Event
responses omit legacy fields rather than inventing a schedule or timezone.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `schedule?` | `string` \| `null` | Deprecated: use `trigger.schedule`. Present only for cron actions. **Deprecated** |
| `timezone?` | `string` \| `null` | Deprecated: use `trigger.timezone`. Present only for cron actions. **Deprecated** |
