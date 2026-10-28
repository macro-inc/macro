# Type Alias: PatchTeamCrmSettingsRequest

> **PatchTeamCrmSettingsRequest** = \{ `backfill?`: `boolean`; `enabled`: `boolean`; \}

Request body for `PATCH /team/crm`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-backfill"></a> `backfill?` | `boolean` | On a disabled → enabled transition, whether to backfill the CRM from members' existing email history. Ignored when disabling. |
| <a id="property-enabled"></a> `enabled` | `boolean` | The desired CRM state for the team. |
