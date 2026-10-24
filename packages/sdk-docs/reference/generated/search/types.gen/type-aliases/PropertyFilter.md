# Type Alias: PropertyFilter

> **PropertyFilter** = \{ `date_range?`: `null` \| [`DateRange`](DateRange.md); `entity_ids?`: `string`[]; `entity_type?`: `string` \| `null`; `has_date?`: `boolean` \| `null`; `option_ids?`: `string`[]; `property_definition_id`: `string`; \}

A single property-based filter condition.

Each filter targets a specific property definition on entities of a given type,
matching against select option UUIDs or entity reference IDs.
Multiple values within a single filter are OR'd together.
Multiple filters are AND'd together.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-date_range"></a> `date_range?` | `null` \| [`DateRange`](DateRange.md) | - |
| <a id="property-entity_ids"></a> `entity_ids?` | `string`[] | Entity reference IDs to match. Multiple values are OR'd together. |
| <a id="property-entity_type"></a> `entity_type?` | `string` \| `null` | The entity type for the property lookup (e.g., "TASK", "DOCUMENT", "PROJECT"). When None, matches across all entity types. |
| <a id="property-has_date"></a> `has_date?` | `boolean` \| `null` | True matches non-null dates; false matches missing or cleared dates. |
| <a id="property-option_ids"></a> `option_ids?` | `string`[] | Select option UUIDs to match. Multiple values are OR'd together. |
| <a id="property-property_definition_id"></a> `property_definition_id` | `string` | The UUID of the property definition to filter on. |
