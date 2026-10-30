# Class: AgentSessionNamespace

Entry point for coding-agent sessions.

## Constructors

### Constructor

> **new AgentSessionNamespace**(`client`): `AgentSessionNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`AgentSessionNamespace`

## Methods

### autoArchivePreferences()

> **autoArchivePreferences**(): `Promise`\<[`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md)\>

Which triggers archive the caller's sessions by default; each is off unless chosen.

#### Returns

`Promise`\<[`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md)\>

***

### byId()

> **byId**(`id`): [`AgentSession`](../../agent-session/classes/AgentSession.md)

A handle to an agent session by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`AgentSession`](../../agent-session/classes/AgentSession.md)

***

### chooseMode()

> **chooseMode**(`prompt`): `Promise`\<[`AgentMode`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentMode.md)\>

Whether `prompt` needs a chat agent (`'chat'`) or a coding agent
(`'code'`), as the app's Auto mode decides before starting a session.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `prompt` | `string` |

#### Returns

`Promise`\<[`AgentMode`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentMode.md)\>

***

### codingPreferences()

> **codingPreferences**(): `Promise`\<[`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md)\>

What the caller's new coding sessions are told to do beyond their assignment.

#### Returns

`Promise`\<[`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md)\>

***

### createManaged()

> **createManaged**(`opts?`): `Promise`\<[`AgentSession`](../../agent-session/classes/AgentSession.md)\>

Create a managed agent session.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts?` | [`CreateManagedSessionOptions`](../../agent-session/type-aliases/CreateManagedSessionOptions.md) |

#### Returns

`Promise`\<[`AgentSession`](../../agent-session/classes/AgentSession.md)\>

***

### defaultSandboxSize()

> **defaultSandboxSize**(): `Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>

The caller's default sandbox size for new `@coder` sessions.

#### Returns

`Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>

***

### forPullRequest()

> **forPullRequest**(`url`): `Promise`\<[`AgentSession`](../../agent-session/classes/AgentSession.md)[]\>

The sessions linked to the GitHub pull request at `url` that the caller
can view.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `url` | `string` |

#### Returns

`Promise`\<[`AgentSession`](../../agent-session/classes/AgentSession.md)[]\>

***

### repositories()

> **repositories**(): `Promise`\<[`SelectableRepository`](../../agent-session/type-aliases/SelectableRepository.md)[]\>

The GitHub repositories the caller can hand a managed session, with the
branch each one's sessions start on by default.

#### Returns

`Promise`\<[`SelectableRepository`](../../agent-session/type-aliases/SelectableRepository.md)[]\>

***

### repositoryBranches()

> **repositoryBranches**(`repoUrl`): `Promise`\<`string`[]\>

Branch names on one repository the caller can start a managed session
from. `repoUrl` is one of the URLs [AgentSessionNamespace.repositories](#repositories)
lists.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `repoUrl` | `string` |

#### Returns

`Promise`\<`string`[]\>

***

### setAutoArchivePreferences()

> **setAutoArchivePreferences**(`preferences`): `Promise`\<[`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md)\>

Replace which triggers archive the caller's sessions by default.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `preferences` | [`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md) |

#### Returns

`Promise`\<[`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md)\>

***

### setCodingPreferences()

> **setCodingPreferences**(`preferences`): `Promise`\<[`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md)\>

Replace the caller's coding preferences.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `preferences` | [`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md) |

#### Returns

`Promise`\<[`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md)\>

***

### setDefaultSandboxSize()

> **setDefaultSandboxSize**(`size`): `Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>

Set the caller's default sandbox size for the next `@coder` mention.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `size` | [`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md) |

#### Returns

`Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>
