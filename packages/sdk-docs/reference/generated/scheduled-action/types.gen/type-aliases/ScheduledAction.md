# Type Alias: ScheduledAction

> **ScheduledAction** = \{ `claimed?`: `string` \| `null`; `configuration_revision`: `number`; `created_at`: `string`; `enabled`: `boolean`; `event_activated_at?`: `string` \| `null`; `id?`: `string` \| `null`; `kind`: [`ActionKind`](ActionKind.md); `name`: `string`; `next_run_at?`: `string` \| `null`; `owner`: `string`; `task`: \{\[`key`: `string`\]: `unknown`; \}; `trigger`: [`ActionTrigger`](ActionTrigger.md); `updated_at`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-claimed"></a> `claimed?` | `string` \| `null` | - |
| <a id="property-configuration_revision"></a> `configuration_revision` | `number` | Independent of execution bookkeeping in `updated_at`. |
| <a id="property-created_at"></a> `created_at` | `string` | - |
| <a id="property-enabled"></a> `enabled` | `boolean` | When false, automatic dispatch skips this action. `run_now` remains available regardless. |
| <a id="property-event_activated_at"></a> `event_activated_at?` | `string` \| `null` | Event publication boundary; absent for cron actions. |
| <a id="property-id"></a> `id?` | `string` \| `null` | - |
| <a id="property-kind"></a> `kind` | [`ActionKind`](ActionKind.md) | - |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-next_run_at"></a> `next_run_at?` | `string` \| `null` | Next cron firing, absent for event-triggered actions. |
| <a id="property-owner"></a> `owner` | `string` | Who the action belongs to. Every action is user-owned today, but the type no longer says so: the principal string on the wire and in the `owner` column is the same, and a bot- or team-owned row decodes rather than failing to parse. |
| <a id="property-task"></a> `task` | \{\[`key`: `string`\]: `unknown`; \} | - |
| <a id="property-trigger"></a> `trigger` | [`ActionTrigger`](ActionTrigger.md) | - |
| <a id="property-updated_at"></a> `updated_at` | `string` | - |
