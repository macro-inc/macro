# Type Alias: AgentSessionSearchResult

> **AgentSessionSearchResult** = \{ `goto?`: `null` \| [`SearchGotoAgentSession`](SearchGotoAgentSession.md); `highlight`: [`SearchHighlight`](SearchHighlight.md); `score?`: `number` \| `null`; \}

A name match or one matching folded message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-goto"></a> `goto?` | `null` \| [`SearchGotoAgentSession`](SearchGotoAgentSession.md) | - |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | Matched name/content fragments. |
| <a id="property-score"></a> `score?` | `number` \| `null` | Search score. |
