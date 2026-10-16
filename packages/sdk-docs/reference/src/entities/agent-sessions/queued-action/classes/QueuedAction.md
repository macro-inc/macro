# Class: QueuedAction

One action waiting in an agent session's server-side queue: a prompt or a
compact accepted while a turn was running, dispatching when that turn
ends. Until then it can be edited (prompts only), steered, or removed; once
it has dispatched, these actions answer 404 — there is no un-sending.

List-sourced only - there is no per-action GET, only the queue snapshot -
so this wraps whatever DTO the caller already has, the same shape
`CrmComment` wraps a list-sourced record, rather than `MacroEntity`'s
lazy-fetch-by-id.

## Accessors

### actionId

#### Get Signature

> **get** **actionId**(): `string`

The id the action was accepted under. Once it dispatches, this equals
`requestId` on the folded message the action derives.

##### Returns

`string`

***

### actorUserId

#### Get Signature

> **get** **actorUserId**(): `string` \| `undefined`

The user who queued it, absent when a bot acted on nobody's behalf.

##### Returns

`string` \| `undefined`

***

### attachments

#### Get Signature

> **get** **attachments**(): [`PromptAttachment`](../../../../../generated/agent-harness/types.gen/type-aliases/PromptAttachment.md)[]

Files the prompt refers to; empty for a compact. Kept through an edit.

##### Returns

[`PromptAttachment`](../../../../../generated/agent-harness/types.gen/type-aliases/PromptAttachment.md)[]

***

### createdAt

#### Get Signature

> **get** **createdAt**(): `string`

When the action was accepted, as an RFC 3339 timestamp.

##### Returns

`string`

***

### kind

#### Get Signature

> **get** **kind**(): `string`

`prompt` or `compact`; only turn-occupying actions are ever queued.

##### Returns

`string`

***

### prompt

#### Get Signature

> **get** **prompt**(): `string` \| `undefined`

The prompt's raw text, present for prompts only. What an edit replaces.

##### Returns

`string` \| `undefined`

## Methods

### edit()

> **edit**(`prompt`): `Promise`\<`QueuedAction`\>

Replace this queued prompt's text before it dispatches. Returns this
handle for chaining; the edit endpoint answers 204, so `prompt` is
applied locally rather than reread from a response body.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `prompt` | `string` |

#### Returns

`Promise`\<`QueuedAction`\>

***

### remove()

> **remove**(): `Promise`\<`void`\>

Remove this action from the queue before it dispatches.

#### Returns

`Promise`\<`void`\>

***

### steer()

> **steer**(): `Promise`\<`void`\>

Move this action to the front and interrupt the current turn to run it next.

#### Returns

`Promise`\<`void`\>

***

### from()

> `static` **from**(`client`, `sessionId`, `dto`): `QueuedAction`

Wrap a queue entry already in hand (e.g. from `AgentSession.queue()`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `sessionId` | `string` |
| `dto` | [`QueuedActionDto`](../../../../../generated/agent-harness/types.gen/type-aliases/QueuedActionDto.md) |

#### Returns

`QueuedAction`
