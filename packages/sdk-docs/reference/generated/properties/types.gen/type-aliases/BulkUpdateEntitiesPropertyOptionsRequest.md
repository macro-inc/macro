# Type Alias: BulkUpdateEntitiesPropertyOptionsRequest

> **BulkUpdateEntitiesPropertyOptionsRequest** = \{ `add_option_ids?`: `string`[]; `entities`: [`PropertyTargetReference`](PropertyTargetReference.md)[]; `property_id`: `string`; `remove_option_ids?`: `string`[]; \}

Request to apply one shared option delta across several entities in a single
call. Mirrors the per-entity bulk endpoint's delta semantics, applied to
every listed entity (e.g. tag N emails with one label in one request).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-add_option_ids"></a> `add_option_ids?` | `string`[] | Options to add to each entity's current value (deduped). |
| <a id="property-entities"></a> `entities` | [`PropertyTargetReference`](PropertyTargetReference.md)[] | The entities to update. Entities the caller cannot edit are skipped. |
| <a id="property-property_id"></a> `property_id` | `string` | The multi-select property definition changed on every entity. |
| <a id="property-remove_option_ids"></a> `remove_option_ids?` | `string`[] | Options to remove from each entity's current value (a no-op if absent). |
