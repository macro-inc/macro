# Type Alias: EmailReminderSummary

> **EmailReminderSummary** = \{ `followup`: [`EmailFollowup`](EmailFollowup.md); `threadId`: `string`; \}

An original thread with its active snooze.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-followup"></a> `followup` | [`EmailFollowup`](EmailFollowup.md) | Active snooze, including the revision required for edits or removal. |
| <a id="property-threadid"></a> `threadId` | `string` | Original email identity, never a mirror reminder identity. |
