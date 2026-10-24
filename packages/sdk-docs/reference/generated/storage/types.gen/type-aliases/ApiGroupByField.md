# Type Alias: ApiGroupByField

> **ApiGroupByField** = `"date"` \| `"entity_type"` \| `"project"` \| \{ `property`: \{ `entity_type?`: `null` \| [`ApiPropertyEntityType`](ApiPropertyEntityType.md); `property_definition_id`: `string`; \}; \} \| \{ `deadline`: [`ApiDeadlineBoundaries`](ApiDeadlineBoundaries.md); \}

API representation of group-by field.

## Union Members

`"date"`

***

`"entity_type"`

***

`"project"`

***

### Type Literal

\{ `property`: \{ `entity_type?`: `null` \| [`ApiPropertyEntityType`](ApiPropertyEntityType.md); `property_definition_id`: `string`; \}; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `property` | \{ `entity_type?`: `null` \| [`ApiPropertyEntityType`](ApiPropertyEntityType.md); `property_definition_id`: `string`; \} | Group by a property value (e.g., status, priority, or custom properties) |
| `property.entity_type?` | `null` \| [`ApiPropertyEntityType`](ApiPropertyEntityType.md) | - |
| `property.property_definition_id` | `string` | The property definition UUID to group by |

***

### Type Literal

\{ `deadline`: [`ApiDeadlineBoundaries`](ApiDeadlineBoundaries.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `deadline` | [`ApiDeadlineBoundaries`](ApiDeadlineBoundaries.md) | Group task deadlines using frozen viewer-local calendar boundaries. |
