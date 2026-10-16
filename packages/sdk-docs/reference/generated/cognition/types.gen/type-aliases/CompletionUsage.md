# Type Alias: CompletionUsage

> **CompletionUsage** = \{ `cost`: [`Usage`](Usage.md); `entity?`: `string` \| `null`; `feature`: [`AiFeature`](AiFeature.md); `user`: [`MacroUserIdStr`](MacroUserIdStr.md); \}

User and feature attribution for one invocation.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-cost"></a> `cost` | [`Usage`](Usage.md) | Measured usage and resolved cost. |
| <a id="property-entity"></a> `entity?` | `string` \| `null` | Related entity, if any. |
| <a id="property-feature"></a> `feature` | [`AiFeature`](AiFeature.md) | Feature that performed the invocation. |
| <a id="property-user"></a> `user` | [`MacroUserIdStr`](MacroUserIdStr.md) | User the invocation was performed for. |
