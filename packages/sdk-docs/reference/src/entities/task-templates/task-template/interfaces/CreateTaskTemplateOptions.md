# Interface: CreateTaskTemplateOptions

Content for a new personal or team-owned task template.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-descriptionmarkdown"></a> `descriptionMarkdown?` | `string` | Description Markdown inserted into a blank task description. |
| <a id="property-idempotencykey"></a> `idempotencyKey?` | `string` | Client-generated UUID; reuse the key and input when retrying creation. |
| <a id="property-name"></a> `name` | `string` | Template name. |
| <a id="property-properties"></a> `properties?` | readonly [`TaskTemplateProperty`](TaskTemplateProperty.md)[] | Selected fields and optional default values. |
| <a id="property-team"></a> `team?` | [`Team`](../../../teams/team/classes/Team.md) | Omit for a personal template; team templates stay with this team. |
