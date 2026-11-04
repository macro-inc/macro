# Class: TaskTemplate

Personal or team-owned task defaults; existing tasks never change with a template.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`TaskTemplate`](../../../../../generated/storage/types.gen/type-aliases/TaskTemplate.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-canmanage"></a> `canManage` | `readonly` | () => `Promise`\<`boolean`\> | Whether the current actor can update or delete this template. | - |
| <a id="property-creator"></a> `creator` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md) \| `undefined`\> | Original creator, absent after that account is deleted. | - |
| <a id="property-descriptionmarkdown"></a> `descriptionMarkdown` | `readonly` | () => `Promise`\<`string`\> | Description Markdown used only when the current task description is blank. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | The template's name. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md) \| `undefined`\> | Personal owner; absent for team-owned templates. | - |
| <a id="property-revision"></a> `revision` | `readonly` | () => `Promise`\<`number`\> | Revision read with the template; stale writes fail rather than overwrite changes. | - |
| <a id="property-team"></a> `team` | `readonly` | () => `Promise`\<[`Team`](../../../teams/team/classes/Team.md) \| `undefined`\> | Owning team; absent for personal templates. | - |

## Methods

### delete()

> **delete**(): `Promise`\<`void`\>

Delete a managed template at its observed revision without deleting any created tasks.

#### Returns

`Promise`\<`void`\>

***

### properties()

> **properties**(): `Promise`\<[`TaskTemplateProperty`](../interfaces/TaskTemplateProperty.md)[]\>

Selected property handles and their optional defaults, including blank fields.

#### Returns

`Promise`\<[`TaskTemplateProperty`](../interfaces/TaskTemplateProperty.md)[]\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`TaskTemplate`](../../../../../generated/storage/types.gen/type-aliases/TaskTemplate.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`TaskTemplate`](../../../../../generated/storage/types.gen/type-aliases/TaskTemplate.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`TaskTemplate`](../../../../../generated/storage/types.gen/type-aliases/TaskTemplate.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`opts`): `Promise`\<`void`\>

Update a managed template; after a revision conflict, read a fresh handle before retrying.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`UpdateTaskTemplateOptions`](../interfaces/UpdateTaskTemplateOptions.md) |

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `id`): `TaskTemplate`

A template handle; detail loads on first access using current permissions.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`TaskTemplate`

***

### create()

> `static` **create**(`client`, `opts`): `Promise`\<`TaskTemplate`\>

Create a personal template, or a team-owned template while currently a member.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts` | [`CreateTaskTemplateOptions`](../interfaces/CreateTaskTemplateOptions.md) |

#### Returns

`Promise`\<`TaskTemplate`\>

***

### list()

> `static` **list**(`client`, `opts?`): `Promise`\<`TaskTemplate`[]\>

List personal templates and, when supplied, a current team's templates.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts?` | \{ `team?`: [`Team`](../../../teams/team/classes/Team.md); \} |
| `opts.team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<`TaskTemplate`[]\>
