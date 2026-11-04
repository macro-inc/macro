# Type Alias: CreateTaskTemplateRequest

> **CreateTaskTemplateRequest** = \{ `configuration`: [`TaskTemplateConfiguration`](TaskTemplateConfiguration.md); `id?`: `string` \| `null`; `name`: `string`; `teamId?`: `string` \| `null`; \}

Create a personal template or one owned by a current team.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-configuration"></a> `configuration` | [`TaskTemplateConfiguration`](TaskTemplateConfiguration.md) | Reusable task fields and description. |
| <a id="property-id"></a> `id?` | `string` \| `null` | Client-generated creation identity; reuse the same ID and input when retrying. |
| <a id="property-name"></a> `name` | `string` | Template name. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | Owning team; omission creates a personal template. |
