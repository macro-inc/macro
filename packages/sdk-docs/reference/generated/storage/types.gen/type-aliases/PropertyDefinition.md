# Type Alias: PropertyDefinition

> **PropertyDefinition** = \{ `created_at`: `string`; `data_type`: [`DataType`](DataType.md); `display_name`: `string`; `id`: `string`; `is_metadata`: `boolean`; `is_multi_select`: `boolean`; `is_system`: `boolean`; `owner`: [`PropertyOwner`](PropertyOwner.md); `specific_entity_type`: `null` \| [`EntityType`](EntityType.md); `updated_at`: `string`; \}

Property definition model (service representation).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at"></a> `created_at` | `string` | - |
| <a id="property-data_type"></a> `data_type` | [`DataType`](DataType.md) | - |
| <a id="property-display_name"></a> `display_name` | `string` | - |
| <a id="property-id"></a> `id` | `string` | - |
| <a id="property-is_metadata"></a> `is_metadata` | `boolean` | Flag to indicate if this is a system-generated metadata property. Not stored in database - computed at service layer. |
| <a id="property-is_multi_select"></a> `is_multi_select` | `boolean` | - |
| <a id="property-is_system"></a> `is_system` | `boolean` | Flag to indicate if this is a system property (stored in DB). |
| <a id="property-owner"></a> `owner` | [`PropertyOwner`](PropertyOwner.md) | - |
| <a id="property-specific_entity_type"></a> `specific_entity_type` | `null` \| [`EntityType`](EntityType.md) | - |
| <a id="property-updated_at"></a> `updated_at` | `string` | - |
