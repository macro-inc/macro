# Type Alias: AgentPermissionAction

> **AgentPermissionAction** = \{ `answer`: [`PermissionAnswer`](PermissionAnswer.md); `requestId`: `unknown`; \}

A user's answer to the agent's `session/request_permission`.

Unlike every other action this is not a new request but the reply to one
the agent made, so it carries the agent's own request id rather than
receiving a server-minted one.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-answer"></a> `answer` | [`PermissionAnswer`](PermissionAnswer.md) | What the user decided. |
| <a id="property-requestid"></a> `requestId` | `unknown` | The agent's JSON-RPC request id, echoed verbatim from the folded permission part. A string or a number on the wire; agents mint both, and `7` does not answer `"7"`. |
