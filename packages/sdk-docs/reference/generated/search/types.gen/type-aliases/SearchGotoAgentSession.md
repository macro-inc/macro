# Type Alias: SearchGotoAgentSession

> **SearchGotoAgentSession** = \{ `author`: [`AgentSessionAuthor`](AgentSessionAuthor.md); `message_turn`: `number`; \}

Stable navigation target from the fold, independent of raw ACP log IDs.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-author"></a> `author` | [`AgentSessionAuthor`](AgentSessionAuthor.md) | Author within the turn. |
| <a id="property-message_turn"></a> `message_turn` | `number` | Fold-assigned turn. |
