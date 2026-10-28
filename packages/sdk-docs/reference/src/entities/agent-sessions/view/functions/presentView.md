# Function: presentView()

> **presentView**(`client`, `session`, `view`, `execution?`): `Promise`\<`void`\>

Present a view in a session: a review with nothing saved. The view is
checked and drawn at once; one that does not match throws with what to fix.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `session` | [`AgentSession`](../../agent-session/classes/AgentSession.md) |
| `view` | \{\[`key`: `string`\]: `unknown`; \} |
| `execution?` | [`CodeExecution`](../../code-execution/classes/CodeExecution.md) |

## Returns

`Promise`\<`void`\>
