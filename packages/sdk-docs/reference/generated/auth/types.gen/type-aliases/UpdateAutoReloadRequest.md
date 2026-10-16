# Type Alias: UpdateAutoReloadRequest

> **UpdateAutoReloadRequest** = \{ `enabled`: `boolean`; `minimumBalanceCents`: `number`; `monthlySpendLimitCents?`: `number` \| `null`; `targetBalanceCents`: `number`; \}

Request body for [`update_auto_reload_handler`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-enabled"></a> `enabled` | `boolean` | Purchase prepaid credits automatically using the payer's card. |
| <a id="property-minimumbalancecents"></a> `minimumBalanceCents` | `number` | Reload once the balance drops below this, cents. Must be positive. |
| <a id="property-monthlyspendlimitcents"></a> `monthlySpendLimitCents?` | `number` \| `null` | Most to reload per calendar month, cents. Omit or `null` for no limit. Must be at least the catalog's `overage_limit_min_cents` (legacy name). |
| <a id="property-targetbalancecents"></a> `targetBalanceCents` | `number` | Reload the balance back up to this, cents. At least $0.50 above the minimum and no more than the catalog's `auto_reload_target_max_cents`. |
