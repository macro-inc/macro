# Type Alias: UpdateTaskTemplateRequest

> **UpdateTaskTemplateRequest** = \{ `configuration`: [`TaskTemplateConfiguration`](TaskTemplateConfiguration.md); `name`: `string`; `revision`: `number`; \}

Replace content without changing ownership.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-configuration"></a> `configuration` | [`TaskTemplateConfiguration`](TaskTemplateConfiguration.md) | Replacement task fields and description. |
| <a id="property-name"></a> `name` | `string` | Replacement name. |
| <a id="property-revision"></a> `revision` | `number` | Revision observed when editing began. |
