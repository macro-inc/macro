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

| Parameter | Type |
| ------ | ------ |
| `opts` | [`TaskOptions`](../../task/interfaces/TaskOptions.md) |

#### Returns

`Promise`\<[`Task`](../../task/classes/Task.md)\>

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
