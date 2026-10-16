# Type Alias: ElicitationRequestId

> **ElicitationRequestId** = `number` \| `string`

The JSON-RPC id of an agent's `elicitation/create` request, carried whole
so the answer echoes exactly what the agent sent.

Agents pick these, not us: Claude Code counts from `0`, others use
strings. `null` is not a legal id for a request that expects a response,
so it is not representable here.
