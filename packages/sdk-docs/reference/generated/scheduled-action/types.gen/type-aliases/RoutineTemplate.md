# Type Alias: RoutineTemplate

> **RoutineTemplate** = \{ `active_count`: `number`; `author`: `string`; `created_at`: `string`; `description`: `string`; `id`: `string`; `name`: `string`; `task`: \{\[`key`: `string`\]: `unknown`; \}; `trigger`: [`ActionTrigger`](ActionTrigger.md); `updated_at`: `string`; `variables`: [`TemplateVariable`](TemplateVariable.md)[]; \}

A shared routine's snapshot, readable by signed-in users with sharing enabled.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-active_count"></a> `active_count` | `number` | Routines activated from this template, including stopped ones. |
| <a id="property-author"></a> `author` | `string` | Who shared it: the source routine's owner. |
| <a id="property-created_at"></a> `created_at` | `string` | - |
| <a id="property-description"></a> `description` | `string` | - |
| <a id="property-id"></a> `id` | `string` | The routine it was shared from. |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-task"></a> `task` | \{\[`key`: `string`\]: `unknown`; \} | - |
| <a id="property-trigger"></a> `trigger` | [`ActionTrigger`](ActionTrigger.md) | - |
| <a id="property-updated_at"></a> `updated_at` | `string` | - |
| <a id="property-variables"></a> `variables` | [`TemplateVariable`](TemplateVariable.md)[] | - |
