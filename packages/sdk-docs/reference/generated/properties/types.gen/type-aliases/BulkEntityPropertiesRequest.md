# Type Alias: BulkEntityPropertiesRequest

> **BulkEntityPropertiesRequest** = \{ `entities`: [`PropertyTargetReference`](PropertyTargetReference.md)[]; `property_ids?`: `string`[]; \}

Request for getting properties for multiple entities in bulk

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-entities"></a> `entities` | [`PropertyTargetReference`](PropertyTargetReference.md)[] | Array of entity references (entity_id and entity_type pairs) |
| <a id="property-property_ids"></a> `property_ids?` | `string`[] | Optional: only return properties with these definition IDs. If empty, returns all. |
