# Type Alias: SessionSettledMetadata

> **SessionSettledMetadata** = \{ `identity`: [`SessionIdentity`](SessionIdentity.md); `last_turn?`: `null` \| [`TurnSummary`](TurnSummary.md); \}

A turn ended and nothing is queued: the agent has stopped working.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-identity"></a> `identity` | [`SessionIdentity`](SessionIdentity.md) | The session. |
| <a id="property-last_turn"></a> `last_turn?` | `null` \| [`TurnSummary`](TurnSummary.md) | - |
