# Type Alias: EmailFollowup

> **EmailFollowup** = \{ `condition`: [`EmailReminderCondition`](EmailReminderCondition.md); `linkId`: `string`; `remindAt`: `string`; `reminderId`: `string`; `revision`: `string`; `state`: [`FollowupState`](FollowupState.md); `threadId`: `string`; \}

Public status shown on email and in the Reminders editor.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-condition"></a> `condition` | [`EmailReminderCondition`](EmailReminderCondition.md) | Condition, defaulting to no reply for new follow-ups. |
| <a id="property-linkid"></a> `linkId` | `string` | Canonical owned/delegated inbox. |
| <a id="property-remindat"></a> `remindAt` | `string` | Confirmed schedule. |
| <a id="property-reminderid"></a> `reminderId` | `string` | Identity of the snooze and its delivery records. |
| <a id="property-revision"></a> `revision` | `string` | Last accepted operation; edits/removal compare this to prevent stale undo. |
| <a id="property-state"></a> `state` | [`FollowupState`](FollowupState.md) | Durable lifecycle progress. |
| <a id="property-threadid"></a> `threadId` | `string` | Conversation identity. |
