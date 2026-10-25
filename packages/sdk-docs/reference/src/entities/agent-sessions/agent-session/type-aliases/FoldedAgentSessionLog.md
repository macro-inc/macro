# Type Alias: FoldedAgentSessionLog

> **FoldedAgentSessionLog** = \{ `bot`: [`SessionBot`](../../../../../generated/agent-harness/types.gen/type-aliases/SessionBot.md); `messages`: `FoldedMessage`[]; \}

A session's history folded into readable messages, oldest first.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bot"></a> `bot` | [`SessionBot`](../../../../../generated/agent-harness/types.gen/type-aliases/SessionBot.md) | The agent that sent every agent message. |
| <a id="property-messages"></a> `messages` | `FoldedMessage`[] | Prompts and replies with their tool calls, results, plans, permission requests and how each turn ended. |
