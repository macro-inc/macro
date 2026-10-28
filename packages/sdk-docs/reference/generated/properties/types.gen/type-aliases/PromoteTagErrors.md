# Type Alias: PromoteTagErrors

> **PromoteTagErrors** = \{ `403`: `unknown`; `404`: `unknown`; `409`: [`TagPromotionConflictResponse`](TagPromotionConflictResponse.md); `500`: `unknown`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-403"></a> `403` | `unknown` | Team membership required |
| <a id="property-404"></a> `404` | `unknown` | Label not found in the caller's tag set |
| <a id="property-409"></a> `409` | [`TagPromotionConflictResponse`](TagPromotionConflictResponse.md) | The team already has a label with that name |
| <a id="property-500"></a> `500` | `unknown` | Internal server error |
