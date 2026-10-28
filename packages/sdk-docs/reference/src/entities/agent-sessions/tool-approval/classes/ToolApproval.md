# Class: ToolApproval

A permission request scoped to its originating agent session.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` | Approval identity. |
| <a id="property-session"></a> `session` | `readonly` | [`AgentSession`](../../agent-session/classes/AgentSession.md) | Owning session. |

## Methods

### answer()

> **answer**(`answer`): `Promise`\<[`AnswerToolApprovalResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AnswerToolApprovalResponse.md)\>

Answer the approval using the generated discriminated answer contract.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `answer` | [`ToolApprovalAnswerDto`](../../../../../generated/agent-harness/types.gen/type-aliases/ToolApprovalAnswerDto.md) |

#### Returns

`Promise`\<[`AnswerToolApprovalResponse`](../../../../../generated/agent-harness/types.gen/type-aliases/AnswerToolApprovalResponse.md)\>

***

### toJSON()

> **toJSON**(): \{ `id`: `string`; `sessionId`: `string`; \}

Serialize scoped identity only.

#### Returns

\{ `id`: `string`; `sessionId`: `string`; \}

| Name | Type |
| ------ | ------ |
| `id` | `string` |
| `sessionId` | `string` |

***

### byId()

> `static` **byId**(`client`, `session`, `id`): `ToolApproval`

Construct a scoped approval handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `session` | [`AgentSession`](../../agent-session/classes/AgentSession.md) |
| `id` | `string` |

#### Returns

`ToolApproval`
