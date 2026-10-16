# Type Alias: ColumnCast

> **ColumnCast** = \{ `cast`: [`CastVerdict`](CastVerdict.md); `data_type`: [`DataType`](DataType.md); `examples`: `string`[]; `failures`: `number`; `is_multi_select`: `boolean`; `reason`: `string` \| `null`; `relation`: `boolean`; `specific_entity_type`: `null` \| [`EntityType`](EntityType.md); `summary`: `string` \| `null`; \}

What changing a column to one type would do to its values: the dry run
of a type change, for one target.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-cast"></a> `cast` | [`CastVerdict`](CastVerdict.md) | Whether the values convert. |
| <a id="property-data_type"></a> `data_type` | [`DataType`](DataType.md) | The target property type. |
| <a id="property-examples"></a> `examples` | `string`[] | Up to three of the values that would not convert. |
| <a id="property-failures"></a> `failures` | `number` | For a `checked` cast, how many cells would not convert. |
| <a id="property-is_multi_select"></a> `is_multi_select` | `boolean` | Whether the target holds several values. |
| <a id="property-reason"></a> `reason` | `string` \| `null` | Why nothing converts, for a `never` cast. |
| <a id="property-relation"></a> `relation` | `boolean` | Whether the target is a relation to another table's rows. |
| <a id="property-specific_entity_type"></a> `specific_entity_type` | `null` \| [`EntityType`](EntityType.md) | - |
| <a id="property-summary"></a> `summary` | `string` \| `null` | For a `checked` cast with failures, what is wrong with them, as in `3 values aren't numbers`. |
