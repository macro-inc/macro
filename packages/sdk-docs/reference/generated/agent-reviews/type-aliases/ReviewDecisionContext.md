# Type Alias: ReviewDecisionContext

> **ReviewDecisionContext** = \{ `by`: `string`; `items`: `string`[]; `revision`: `number`; `via`: [`DecisionVia`](DecisionVia.md); \}

Facts about the most recent account-holder decision.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-by"></a> `by` | `string` | Authenticated account holder. |
| <a id="property-items"></a> `items` | `string`[] | Items selected by this decision. |
| <a id="property-revision"></a> `revision` | `number` | Revision claimed by this batch, used in notification deduplication. |
| <a id="property-via"></a> `via` | [`DecisionVia`](DecisionVia.md) | Entry surface. |
