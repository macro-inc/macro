# Type Alias: PatchTeamCrmSettingsResponse

> **PatchTeamCrmSettingsResponse** = \{ `backfill_enqueued`: `number`; `backfill_failed`: `number`; `changed`: `boolean`; `enabled`: `boolean`; \}

Response for `PATCH /team/crm`. Reports both the resulting state
and whether this call changed it; for the enable-flip case it also
reports the backfill fan-out tallies.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-backfill_enqueued"></a> `backfill_enqueued` | `number` | Number of members for whom a `PopulateCrmForUser` message was enqueued. Non-zero only on a disabled → enabled transition; per-user enqueue failures are logged and swallowed. |
| <a id="property-backfill_failed"></a> `backfill_failed` | `number` | Number of members whose enqueue failed (and was swallowed). Non-zero only on a disabled → enabled transition. |
| <a id="property-changed"></a> `changed` | `boolean` | True if this call flipped the value (false → true or true → false). False if the team was already at the requested state. |
| <a id="property-enabled"></a> `enabled` | `boolean` | The resulting `crm_enabled` value after the call. |
