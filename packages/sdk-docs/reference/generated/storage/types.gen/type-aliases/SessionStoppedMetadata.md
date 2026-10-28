# Type Alias: SessionStoppedMetadata

> **SessionStoppedMetadata** = \{ `identity`: [`SessionIdentity`](SessionIdentity.md); `reason`: `string`; `turn_in_flight?`: `null` \| [`InFlightTurnSummary`](InFlightTurnSummary.md); \}

The session's live actor is gone: idle teardown, transport loss, or crash.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-identity"></a> `identity` | [`SessionIdentity`](SessionIdentity.md) | The session. |
| <a id="property-reason"></a> `reason` | `string` | Why it stopped, as the session machine reported it. |
| <a id="property-turn_in_flight"></a> `turn_in_flight?` | `null` \| [`InFlightTurnSummary`](InFlightTurnSummary.md) | - |
