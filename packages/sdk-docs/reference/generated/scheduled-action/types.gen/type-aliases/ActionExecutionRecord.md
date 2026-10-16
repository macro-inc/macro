# Type Alias: ActionExecutionRecord

> **ActionExecutionRecord** = \{ `action_id`: `string`; `created_at`: `string`; `end_time`: `string`; `id?`: `string` \| `null`; `is_success`: `boolean`; `resource_id?`: `string` \| `null`; `result`: \{\[`key`: `string`\]: `unknown`; \}; `start_time`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action_id"></a> `action_id` | `string` | - |
| <a id="property-created_at"></a> `created_at` | `string` | - |
| <a id="property-end_time"></a> `end_time` | `string` | - |
| <a id="property-id"></a> `id?` | `string` \| `null` | - |
| <a id="property-is_success"></a> `is_success` | `boolean` | - |
| <a id="property-resource_id"></a> `resource_id?` | `string` \| `null` | ID of the primary resource produced by this run. Its type is recorded in `result`, independently of the routine's current configuration. |
| <a id="property-result"></a> `result` | \{\[`key`: `string`\]: `unknown`; \} | - |
| <a id="property-start_time"></a> `start_time` | `string` | - |
