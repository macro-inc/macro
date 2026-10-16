# Class: AgentSession

A managed or externally hosted coding-agent session.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`AgentSessionResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionResponse.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-codeexecutions"></a> `codeExecutions` | `readonly` | \{ `byId`: (`id`) => [`CodeExecution`](../../code-execution/classes/CodeExecution.md); \} | Saved code executions scoped to this session. Handle construction makes no request. | - |
| `codeExecutions.byId` | `public` | (`id`) => [`CodeExecution`](../../code-execution/classes/CodeExecution.md) | - | - |
| <a id="property-createdat"></a> `createdAt` | `readonly` | () => `Promise`\<`string`\> | When the session was created. | - |
| <a id="property-harness"></a> `harness` | `readonly` | () => `Promise`\<`string`\> | The agent harness implementation serving the session. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-instructions"></a> `instructions` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Instructions the session's runtime works under, when any were stated at creation. Fixed for the session's life. | - |
| <a id="property-isarchived"></a> `isArchived` | `readonly` | () => `Promise`\<`boolean`\> | Whether the session is archived and read-only. | - |
| <a id="property-model"></a> `model` | `readonly` | () => `Promise`\<`string`\> | The model currently configured for the session. | - |
| <a id="property-modifiedat"></a> `modifiedAt` | `readonly` | () => `Promise`\<`string`\> | When the session was last modified. | - |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | The session's user-facing display name. | - |
| <a id="property-repourl"></a> `repoUrl` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | The repository the agent works with, when one was supplied. | - |
| <a id="property-reviews"></a> `reviews` | `readonly` | \{ `byId`: (`id`) => [`SessionReview`](../../review/classes/SessionReview.md); `create`: (`input`) => `Promise`\<[`SessionReview`](../../review/classes/SessionReview.md)\>; \} | Persisted reviews scoped to this session, with or without a code execution. | - |
| `reviews.byId` | `public` | (`id`) => [`SessionReview`](../../review/classes/SessionReview.md) | - | - |
| `reviews.create` | `public` | (`input`) => `Promise`\<[`SessionReview`](../../review/classes/SessionReview.md)\> | - | - |
| <a id="property-sandboxsize"></a> `sandboxSize` | `readonly` | () => `Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\> | Compute tier of the managed sandbox. | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<[`SessionStatusDto`](../../../../../generated/agent-harness/types.gen/type-aliases/SessionStatusDto.md)\> | The session's latest runtime status. | - |
| <a id="property-workspace"></a> `workspace` | `readonly` | () => `Promise`\<`string`\> | The directory in which the agent harness runs. | - |

## Methods

### archive()

> **archive**(): `Promise`\<`void`\>

Archive this session, making it read-only until unarchived.

#### Returns

`Promise`\<`void`\>

***

### changes()

> **changes**(): `Promise`\<[`AgentSessionChangesResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionChangesResponse.md)\>

Read the latest captured GitHub pull request changes and capture status.

#### Returns

`Promise`\<[`AgentSessionChangesResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionChangesResponse.md)\>

***

### changesPatch()

> **changesPatch**(): `Promise`\<`string`\>

Read the unified diff of the latest captured changeset.

#### Returns

`Promise`\<`string`\>

***

### control()

> **control**(`action`): `Promise`\<[`ControlResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/ControlResponse.md)\>

Send a prompt or lifecycle operation to the live agent session.

The returned `actionId` matches `requestId` on the folded message the
action derives once it dispatches. A `queued` status means a turn was
running: the action waits in the session's queue ([queue](#queue)) and
dispatches when that turn ends.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `action` | [`AgentAction`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentAction.md) |

#### Returns

`Promise`\<[`ControlResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/ControlResponse.md)\>

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete this session and any live resources it owns.

#### Returns

`Promise`\<`void`\>

***

### linkPullRequest()

> **linkPullRequest**(`url`): `Promise`\<`void`\>

Link the GitHub pull request at `url` to this session. Linking one that
is already linked changes nothing.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `url` | `string` |

#### Returns

`Promise`\<`void`\>

***

### log()

> **log**(): `Promise`\<[`AgentSessionLogResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionLogResponse.md)\>

Read the complete raw protocol log for this session.

#### Returns

`Promise`\<[`AgentSessionLogResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionLogResponse.md)\>

***

### prompt()

> **prompt**(`text`, `attachments?`): `Promise`\<[`ControlResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/ControlResponse.md)\>

Send a prompt to the session — sugar over [control](#control).

`attachments` are files the prompt refers to, each by a URL the agent
can fetch (a static file service URL in practice); they reach the agent
as ACP `resource_link` blocks after the text.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |
| `attachments?` | [`PromptAttachment`](../../../../../generated/agent-harness/types.gen/type-aliases/PromptAttachment.md)[] |

#### Returns

`Promise`\<[`ControlResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/ControlResponse.md)\>

***

### pullRequests()

> **pullRequests**(): `Promise`\<[`SessionPullRequest`](../type-aliases/SessionPullRequest.md)[]\>

The GitHub pull requests linked to this session: the one its agent
opened and any a person linked, oldest first.

#### Returns

`Promise`\<[`SessionPullRequest`](../type-aliases/SessionPullRequest.md)[]\>

***

### queue()

> **queue**(): `Promise`\<[`QueuedAction`](../../queued-action/classes/QueuedAction.md)[]\>

The actions waiting to dispatch in this session, oldest first. Each can
be edited or removed until it dispatches.

#### Returns

`Promise`\<[`QueuedAction`](../../queued-action/classes/QueuedAction.md)[]\>

***

### refreshChanges()

> **refreshChanges**(): `Promise`\<[`AgentSessionChangesResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionChangesResponse.md)\>

Request a fresh capture and return the current state while it runs.

#### Returns

`Promise`\<[`AgentSessionChangesResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionChangesResponse.md)\>

***

### rename()

> **rename**(`name`): `Promise`\<`void`\>

Rename this session.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

#### Returns

`Promise`\<`void`\>

***

### setSandboxSize()

> **setSandboxSize**(`size`): `Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>

Resize this session's sandbox and remember the size as the owner's default.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `size` | [`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md) |

#### Returns

`Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`AgentSessionResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionResponse.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`AgentSessionResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionResponse.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`AgentSessionResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AgentSessionResponse.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### unarchive()

> **unarchive**(): `Promise`\<`void`\>

Restore an archived session so it can be edited and prompted again.

#### Returns

`Promise`\<`void`\>

***

### unlinkPullRequest()

> **unlinkPullRequest**(`url`): `Promise`\<`void`\>

Unlink a GitHub pull request a person linked to this session. The pull
request the session's agent opened stays linked.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `url` | `string` |

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `id`): `AgentSession`

A handle to an agent session by id. Details load on first access.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`AgentSession`

***

### codingPreferences()

> `static` **codingPreferences**(`client`): `Promise`\<[`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md)\>

What the caller's new coding sessions are told to do beyond their assignment.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<[`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md)\>

***

### createManaged()

> `static` **createManaged**(`client`, `opts?`): `Promise`\<`AgentSession`\>

Create a managed session, optionally delivering its first prompt.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `opts?` | [`CreateManagedSessionOptions`](../type-aliases/CreateManagedSessionOptions.md) |

#### Returns

`Promise`\<`AgentSession`\>

***

### defaultSandboxSize()

> `static` **defaultSandboxSize**(`client`): `Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>

The caller's default sandbox size for new `@coder` sessions.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>

***

### forPullRequest()

> `static` **forPullRequest**(`client`, `url`): `Promise`\<`AgentSession`[]\>

The sessions linked to the GitHub pull request at `url` that the caller
can view, oldest link first.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `url` | `string` |

#### Returns

`Promise`\<`AgentSession`[]\>

***

### repositories()

> `static` **repositories**(`client`): `Promise`\<[`SelectableRepository`](../type-aliases/SelectableRepository.md)[]\>

The GitHub repositories the caller can hand a managed session: every
repository under an installation of Macro's GitHub App they or their
teams made, sorted by `owner/name`. Empty when the App is installed
nowhere they reach.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<[`SelectableRepository`](../type-aliases/SelectableRepository.md)[]\>

***

### repositoryBranches()

> `static` **repositoryBranches**(`client`, `repoUrl`): `Promise`\<`string`[]\>

Branch names on one repository the caller can start a managed session
from, in the order GitHub listed them. Empty when the repository has
no commits yet. `repoUrl` is one of the URLs [AgentSession.repositories](#repositories)
lists.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `repoUrl` | `string` |

#### Returns

`Promise`\<`string`[]\>

***

### setCodingPreferences()

> `static` **setCodingPreferences**(`client`, `preferences`): `Promise`\<[`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md)\>

Replace the caller's coding preferences.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `preferences` | [`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md) |

#### Returns

`Promise`\<[`CodingPreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/CodingPreferencesBody.md)\>

***

### setDefaultSandboxSize()

> `static` **setDefaultSandboxSize**(`client`, `size`): `Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>

Set the caller's default sandbox size for the next `@coder` mention.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `size` | [`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md) |

#### Returns

`Promise`\<[`SandboxSize`](../../../../../generated/agent-harness/types.gen/type-aliases/SandboxSize.md)\>
