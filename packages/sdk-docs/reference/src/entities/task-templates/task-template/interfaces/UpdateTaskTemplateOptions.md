# Interface: UpdateTaskTemplateOptions

Replacement fields for a task template; omitted fields stay unchanged.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-descriptionmarkdown"></a> `descriptionMarkdown?` | `string` | Replacement description Markdown. |
| <a id="property-name"></a> `name?` | `string` | Replacement template name. |
| <a id="property-properties"></a> `properties?` | readonly [`TaskTemplateProperty`](TaskTemplateProperty.md)[] | Replacement selected fields and defaults; an empty array removes all fields. |
