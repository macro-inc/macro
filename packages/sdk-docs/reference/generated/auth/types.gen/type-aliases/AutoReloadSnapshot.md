# Type Alias: AutoReloadSnapshot

> **AutoReloadSnapshot** = \{ `active`: `boolean`; `minimum_balance_cents`: `number`; `monthly_budget?`: `null` \| [`AutoReloadMonthlyBudget`](AutoReloadMonthlyBudget.md); `monthly_spend_limit_cents?`: `number` \| `null`; `suspended`: `boolean`; `target_balance_cents`: `number`; \}

The payer's automatic reload settings, as shown in Billing settings.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-active"></a> `active` | `boolean` | Whether reloads will fire: the payer opted in and reloads are not suspended. |
| <a id="property-minimum_balance_cents"></a> `minimum_balance_cents` | `number` | Reload once the effective balance drops below this, in customer cents. |
| <a id="property-monthly_budget"></a> `monthly_budget?` | `null` \| [`AutoReloadMonthlyBudget`](AutoReloadMonthlyBudget.md) | - |
| <a id="property-monthly_spend_limit_cents"></a> `monthly_spend_limit_cents?` | `number` \| `null` | Most reloaded per UTC calendar month, in customer cents. `null` when there is no limit. |
| <a id="property-suspended"></a> `suspended` | `boolean` | Whether reloads are paused after a failed reload charge. |
| <a id="property-target_balance_cents"></a> `target_balance_cents` | `number` | Reload the balance back up to this, in customer cents. |
