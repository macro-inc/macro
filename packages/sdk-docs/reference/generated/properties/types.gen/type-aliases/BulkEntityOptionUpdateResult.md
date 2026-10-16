# Type Alias: BulkEntityOptionUpdateResult

> **BulkEntityOptionUpdateResult** = \{ `entity_id`: `string`; `entity_type`: [`PropertyTargetEntityType`](PropertyTargetEntityType.md); `error?`: `string` \| `null`; `option_ids?`: `string`[] \| `null`; `status`: [`BulkEntityOptionUpdateStatus`](BulkEntityOptionUpdateStatus.md); \}

One entity's result in a cross-entity bulk option update.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-entity_id"></a> `entity_id` | `string` | The entity's id this result is for. |
| <a id="property-entity_type"></a> `entity_type` | [`PropertyTargetEntityType`](PropertyTargetEntityType.md) | The entity's type this result is for. |
| <a id="property-error"></a> `error?` | `string` \| `null` | A human-readable reason, present only when `failed`. |
| <a id="property-option_ids"></a> `option_ids?` | `string`[] \| `null` | The entity's reconciled final option ids, present only when `applied`. |
| <a id="property-status"></a> `status` | [`BulkEntityOptionUpdateStatus`](BulkEntityOptionUpdateStatus.md) | Whether the delta was applied, skipped, or failed for this entity. |
