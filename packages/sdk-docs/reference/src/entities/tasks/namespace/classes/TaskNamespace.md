# Class: TaskNamespace

Tasks: one `create` call sets initiative, assignees and due date; one
`summaries` call reads many names (`name()` loads each whole document).
Creating a task needs only what the request states; don't research what it
describes unless asked.

## Constructors

### Constructor

> **new TaskNamespace**(`client`): `TaskNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`TaskNamespace`

## Methods

### byId()

> **byId**(`id`): [`Task`](../../task/classes/Task.md)

A handle to a task by document id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Task`](../../task/classes/Task.md)

***

### create()

> **create**(`opts`): `Promise`\<[`Task`](../../task/classes/Task.md)\>

Create a task, with its initiative, assignees and due date in the same
request. The task starts Not started.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `opts` | \{ `assignees?`: [`User`](../../../users/user/classes/User.md)[]; `dueDate?`: `Date`; `initiative?`: [`Initiative`](../../../initiatives/initiative/classes/Initiative.md); `markdown?`: `string`; `name`: `string`; `project?`: [`Project`](../../../projects/project/classes/Project.md); `shareWithTeam?`: `boolean`; `team?`: [`Team`](../../../teams/team/classes/Team.md); \} | - |
| `opts.assignees?` | [`User`](../../../users/user/classes/User.md)[] | Assignees; defaults to the creator. Pass `[]` to leave it unassigned. |
| `opts.dueDate?` | `Date` | - |
| `opts.initiative?` | [`Initiative`](../../../initiatives/initiative/classes/Initiative.md) | The initiative (shown as the task's Project in the app) it belongs to. |
| `opts.markdown?` | `string` | - |
| `opts.name` | `string` | - |
| `opts.project?` | [`Project`](../../../projects/project/classes/Project.md) | Folder the task document is filed in; unrelated to `initiative`. |
| `opts.shareWithTeam?` | `boolean` | Defaults to true. |
| `opts.team?` | [`Team`](../../../teams/team/classes/Team.md) | Scopes the team task number; may be omitted when the creator belongs to exactly one team. |

#### Returns

`Promise`\<[`Task`](../../task/classes/Task.md)\>

***

### findSimilar()

> **findSimilar**(`opts`): `Promise`\<[`SimilarTask`](../../task/interfaces/SimilarTask.md)[]\>

Existing tasks of yours or your team's that look like the same work as a
task with this title and body, most similar first. Call it before
`create`; if one is a likely duplicate, ask the user instead of creating.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | \{ `body?`: `string`; `title`: `string`; \} |
| `opts.body?` | `string` |
| `opts.title` | `string` |

#### Returns

`Promise`\<[`SimilarTask`](../../task/interfaces/SimilarTask.md)[]\>

***

### forPullRequest()

> **forPullRequest**(`url`): `Promise`\<[`Task`](../../task/classes/Task.md)[]\>

The tasks the GitHub pull request at `url` references, oldest link first.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `url` | `string` |

#### Returns

`Promise`\<[`Task`](../../task/classes/Task.md)[]\>

***

### search()

> **search**(`query`, `opts?`): `AsyncGenerator`\<[`Task`](../../task/classes/Task.md)\>

Search tasks by name and content, most relevant first, auto-paginated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | `string` |
| `opts?` | [`SearchOpts`](../../../search/interfaces/SearchOpts.md) |

#### Returns

`AsyncGenerator`\<[`Task`](../../task/classes/Task.md)\>

***

### summaries()

> **summaries**(`tasks`): `Promise`\<[`TaskSummary`](../../task/interfaces/TaskSummary.md)[]\>

Names and state of many tasks in one request, in the order given. Tasks
that no longer exist are left out.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tasks` | [`Task`](../../task/classes/Task.md)[] |

#### Returns

`Promise`\<[`TaskSummary`](../../task/interfaces/TaskSummary.md)[]\>
