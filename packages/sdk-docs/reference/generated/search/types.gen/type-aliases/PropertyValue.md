# Type Alias: PropertyValue

> **PropertyValue** = \{ `type`: `"Boolean"`; `value`: `boolean`; \} \| \{ `type`: `"Number"`; `value`: `number`; \} \| \{ `type`: `"String"`; `value`: `string`; \} \| \{ `type`: `"Date"`; `value`: `string`; \} \| \{ `type`: `"SelectOption"`; `value`: `string`[]; \} \| \{ `type`: `"EntityReference"`; `value`: [`EntityReference`](EntityReference.md)[]; \} \| \{ `type`: `"Link"`; `value`: `string`[]; \}

Property value (service representation).

Represents the actual value stored for an entity property.
This is serialized to/from JSONB in the database.

## Union Members

### Type Literal

\{ `type`: `"Boolean"`; `value`: `boolean`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"Boolean"` | - |
| `value` | `boolean` | Boolean value Serializes as: {"type": "Boolean", "value": true} |

***

### Type Literal

\{ `type`: `"Number"`; `value`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"Number"` | - |
| `value` | `number` | Numeric value Serializes as: {"type": "Number", "value": 42.5} |

***

### Type Literal

\{ `type`: `"String"`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"String"` | - |
| `value` | `string` | String value Serializes as: {"type": "String", "value": "text"} |

***

### Type Literal

\{ `type`: `"Date"`; `value`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"Date"` | - |
| `value` | `string` | Date/timestamp value Serializes as: {"type": "Date", "value": "2025-01-01T00:00:00Z"} |

***

### Type Literal

\{ `type`: `"SelectOption"`; `value`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"SelectOption"` | - |
| `value` | `string`[] | Select option(s) - always an array (check is_multi_select to determine if single or multi) Single-select: {"type": "SelectOption", "value": ["uuid"]} (length 0 or 1) Multi-select: {"type": "SelectOption", "value": ["uuid1", "uuid2", ...]} (length 0+) |

***

### Type Literal

\{ `type`: `"EntityReference"`; `value`: [`EntityReference`](EntityReference.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"EntityReference"` | - |
| `value` | [`EntityReference`](EntityReference.md)[] | Entity reference(s) - always an array (check is_multi_select to determine if single or multi) Single-select: {"type": "EntityReference", "value": [{...}]} (length 0 or 1) Multi-select: {"type": "EntityReference", "value": [{...}, {...}, ...]} (length 0+) |

***

### Type Literal

\{ `type`: `"Link"`; `value`: `string`[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"Link"` | - |
| `value` | `string`[] | Link value(s) - always an array (check is_multi_select to determine if single or multi) Single-select: {"type": "Link", "value": ["https://example.com"]} (length 0 or 1) Multi-select: {"type": "Link", "value": ["https://example.com", "https://other.com"]} (length 0+) |
