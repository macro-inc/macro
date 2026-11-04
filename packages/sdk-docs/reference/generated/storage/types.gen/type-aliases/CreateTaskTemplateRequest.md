# Type Alias: CreateTaskTemplateRequest

> **CreateTaskTemplateRequest** = \{ `configuration`: [`TaskTemplateConfiguration`](TaskTemplateConfiguration.md); `name`: `string`; `teamId?`: `string` \| `null`; \}

Create a personal template or one owned by a current team.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-configuration"></a> `configuration` | [`TaskTemplateConfiguration`](TaskTemplateConfiguration.md) | Reusable task fields and description. |
| <a id="property-name"></a> `name` | `string` | Template name. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | Owning team; omission creates a personal template. |
