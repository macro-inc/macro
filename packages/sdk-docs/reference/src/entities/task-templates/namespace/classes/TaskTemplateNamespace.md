# Class: TaskTemplateNamespace

Personal and team task templates: reusable selected fields, defaults, and description Markdown.

## Constructors

### Constructor

> **new TaskTemplateNamespace**(`client`): `TaskTemplateNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`TaskTemplateNamespace`

## Methods

### byId()

> **byId**(`id`): [`TaskTemplate`](../../task-template/classes/TaskTemplate.md)

A template handle; detail loads lazily using current account and team permissions.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`TaskTemplate`](../../task-template/classes/TaskTemplate.md)

***

### create()

> **create**(`opts`): `Promise`\<[`TaskTemplate`](../../task-template/classes/TaskTemplate.md)\>

Create a personal template or a template owned by a current team.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`CreateTaskTemplateOptions`](../../task-template/interfaces/CreateTaskTemplateOptions.md) |

#### Returns

`Promise`\<[`TaskTemplate`](../../task-template/classes/TaskTemplate.md)\>

***

### list()

> **list**(`opts?`): `Promise`\<[`TaskTemplate`](../../task-template/classes/TaskTemplate.md)[]\>

List personal templates and, when supplied, a current team's templates.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | \{ `team?`: [`Team`](../../../teams/team/classes/Team.md); \} |
| `opts.team?` | [`Team`](../../../teams/team/classes/Team.md) |

#### Returns

`Promise`\<[`TaskTemplate`](../../task-template/classes/TaskTemplate.md)[]\>
