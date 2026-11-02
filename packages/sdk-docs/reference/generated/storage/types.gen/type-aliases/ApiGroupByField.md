# Type Alias: ApiGroupByField

> **ApiGroupByField** = `"date"` \| `"entity_type"` \| `"project"` \| \{ `property`: \{ `bucketing?`: `null` \| [`PropertyBucketing`](PropertyBucketing.md); `entity_type?`: `null` \| [`ApiPropertyEntityType`](ApiPropertyEntityType.md); `property_definition_id`: `string`; \}; \}

API representation of group-by field.

## Union Members

`"date"`

***

`"entity_type"`

***

`"project"`

***

### Type Literal

\{ `property`: \{ `bucketing?`: `null` \| [`PropertyBucketing`](PropertyBucketing.md); `entity_type?`: `null` \| [`ApiPropertyEntityType`](ApiPropertyEntityType.md); `property_definition_id`: `string`; \}; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `property` | \{ `bucketing?`: `null` \| [`PropertyBucketing`](PropertyBucketing.md); `entity_type?`: `null` \| [`ApiPropertyEntityType`](ApiPropertyEntityType.md); `property_definition_id`: `string`; \} | Group by a property value (e.g., status, priority, or custom properties) |
| `property.bucketing?` | `null` \| [`PropertyBucketing`](PropertyBucketing.md) | - |
| `property.entity_type?` | `null` \| [`ApiPropertyEntityType`](ApiPropertyEntityType.md) | - |
| `property.property_definition_id` | `string` | The property definition UUID to group by |
