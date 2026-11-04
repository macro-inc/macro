# Type Alias: TaskTemplate

> **TaskTemplate** = \{ `canManage`: `boolean`; `configuration`: [`TaskTemplateConfiguration`](TaskTemplateConfiguration.md); `createdAt`: `string`; `creatorId?`: `string` \| `null`; `id`: `string`; `name`: `string`; `revision`: `number`; `teamId?`: `string` \| `null`; `updatedAt`: `string`; `userId?`: `string` \| `null`; \}

A personal or team-owned template with viewer-specific management capability.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-canmanage"></a> `canManage` | `boolean` | Whether the current viewer can update or delete the template. |
| <a id="property-configuration"></a> `configuration` | [`TaskTemplateConfiguration`](TaskTemplateConfiguration.md) | Reusable task fields and description. |
| <a id="property-createdat"></a> `createdAt` | `string` | Creation time. |
| <a id="property-creatorid"></a> `creatorId?` | `string` \| `null` | Original creator; cleared when that account is deleted. |
| <a id="property-id"></a> `id` | `string` | Stable template ID. |
| <a id="property-name"></a> `name` | `string` | User-supplied template name. |
| <a id="property-revision"></a> `revision` | `number` | Positive revision used for conditional updates and deletes. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | Owning team; absent for personal templates. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Last content update time. |
| <a id="property-userid"></a> `userId?` | `string` \| `null` | Personal owner; absent for team-owned templates. |
