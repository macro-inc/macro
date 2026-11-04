# Type Alias: TaskTemplateConfiguration

> **TaskTemplateConfiguration** = \{ `defaults?`: [`PropertyDefault`](PropertyDefault.md)[]; `descriptionMarkdown`: `string`; `propertyIds`: `string`[]; \}

Selected fields, optional default values, and description Markdown.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-defaults"></a> `defaults?` | [`PropertyDefault`](PropertyDefault.md)[] | Defaults for selected fields only. |
| <a id="property-descriptionmarkdown"></a> `descriptionMarkdown` | `string` | Markdown inserted only when the current description is blank. |
| <a id="property-propertyids"></a> `propertyIds` | `string`[] | Visible definition IDs, including fields without a default value. |
