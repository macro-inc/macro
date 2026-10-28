# Type Alias: PlanCatalogResponse

> **PlanCatalogResponse** = \{ `auto_reload_defaults`: [`AutoReloadDefaults`](AutoReloadDefaults.md); `auto_reload_target_max_cents`: `number`; `credit_packs_cents`: `number`[]; `overage_limit_max_cents`: `number`; `overage_limit_min_cents`: `number`; `plans`: [`PlanCatalogEntry`](PlanCatalogEntry.md)[]; \}

The plan catalog and the knobs the billing UI offers.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auto_reload_defaults"></a> `auto_reload_defaults` | [`AutoReloadDefaults`](AutoReloadDefaults.md) | Thresholds automatic reload starts from before the payer sets their own. |
| <a id="property-auto_reload_target_max_cents"></a> `auto_reload_target_max_cents` | `number` | Largest allowed automatic reload target, cents. |
| <a id="property-credit_packs_cents"></a> `credit_packs_cents` | `number`[] | Credit packs a payer may buy, cents. |
| <a id="property-overage_limit_max_cents"></a> `overage_limit_max_cents` | `number` | Largest allowed overage cap, cents. |
| <a id="property-overage_limit_min_cents"></a> `overage_limit_min_cents` | `number` | Smallest allowed overage cap, cents. |
| <a id="property-plans"></a> `plans` | [`PlanCatalogEntry`](PlanCatalogEntry.md)[] | Every plan, cheapest first. Clients read allowances from here rather than hard-coding them; `purchasable` marks the plans a user can buy. |
