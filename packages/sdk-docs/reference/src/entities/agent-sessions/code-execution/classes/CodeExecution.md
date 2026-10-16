# Class: CodeExecution

A saved code execution belonging to one agent session.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ExecutionRecord`](../../../../../generated/agent-harness/types.gen/type-aliases/ExecutionRecord.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-calls"></a> `calls` | `readonly` | () => `Promise`\<[`RecordedToolCall`](../../../../../generated/agent-harness/types.gen/type-aliases/RecordedToolCall.md)[]\> | Legacy bridge calls; direct HTTP executions leave this empty. | - |
| <a id="property-error"></a> `error` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Execution failure text, when present. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-reviews"></a> `reviews` | `readonly` | \{ `create`: (`input`) => `Promise`\<[`SessionReview`](../../review/classes/SessionReview.md)\>; `list`: () => `Promise`\<[`SessionReview`](../../review/classes/SessionReview.md)[]\>; \} | Persistent UI blocks, independent of the execution lifetime. | - |
| `reviews.create` | `public` | (`input`) => `Promise`\<[`SessionReview`](../../review/classes/SessionReview.md)\> | - | - |
| `reviews.list` | `public` | () => `Promise`\<[`SessionReview`](../../review/classes/SessionReview.md)[]\> | - | - |
| <a id="property-source"></a> `source` | `readonly` | () => `Promise`\<`string`\> | The submitted JavaScript module source. | - |
| <a id="property-status"></a> `status` | `readonly` | () => `Promise`\<[`ExecutionStatus`](../../../../../generated/agent-harness/types.gen/type-aliases/ExecutionStatus.md)\> | Saved execution state. Call refresh to observe subsequent changes. | - |

## Methods

### refresh()

> **refresh**(): `Promise`\<`CodeExecution`\>

Reload the saved state, for example after a running execution completes.

#### Returns

`Promise`\<`CodeExecution`\>

***

### result()

> **result**(): `Promise`\<`unknown`\>

The program's returned JSON; preserves an explicit null result.

#### Returns

`Promise`\<`unknown`\>

***

### session()

> **session**(): [`AgentSession`](../../agent-session/classes/AgentSession.md)

The session this execution belongs to.

#### Returns

[`AgentSession`](../../agent-session/classes/AgentSession.md)

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ExecutionRecord`](../../../../../generated/agent-harness/types.gen/type-aliases/ExecutionRecord.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ExecutionRecord`](../../../../../generated/agent-harness/types.gen/type-aliases/ExecutionRecord.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ExecutionRecord`](../../../../../generated/agent-harness/types.gen/type-aliases/ExecutionRecord.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### byId()

> `static` **byId**(`client`, `session`, `id`): `CodeExecution`

Construct a lazy execution handle within its owning session.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `session` | [`AgentSession`](../../agent-session/classes/AgentSession.md) |
| `id` | `string` |

#### Returns

`CodeExecution`
