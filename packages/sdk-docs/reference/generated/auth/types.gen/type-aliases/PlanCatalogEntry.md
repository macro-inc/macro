# Type Alias: PlanCatalogEntry

> **PlanCatalogEntry** = \{ `included_ai_cents_per_seat`: `number`; `monthly_price_cents`: `number`; `purchasable`: `boolean`; `tier`: [`PlanTier`](PlanTier.md); \}

One plan in the catalog.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-included_ai_cents_per_seat"></a> `included_ai_cents_per_seat` | `number` | Included AI per seat per period, in cents at provider cost. For the free plan this is its monthly hard cap. |
| <a id="property-monthly_price_cents"></a> `monthly_price_cents` | `number` | Monthly subscription price per seat, cents. |
| <a id="property-purchasable"></a> `purchasable` | `boolean` | Whether a new purchase or plan move may pick this plan today. |
| <a id="property-tier"></a> `tier` | [`PlanTier`](PlanTier.md) | The tier. |
