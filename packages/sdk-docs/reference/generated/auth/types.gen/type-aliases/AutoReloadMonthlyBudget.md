# Type Alias: AutoReloadMonthlyBudget

> **AutoReloadMonthlyBudget** = \{ `committed_cents`: `number`; `limit_reached`: `boolean`; `resets_at`: `string`; \}

Calendar-month commitments that consume the payer's automatic reload cap.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-committed_cents"></a> `committed_cents` | `number` | Reloads paid, pending, or failed with an invoice that can still collect. Customer cents; manual credit purchases do not count. |
| <a id="property-limit_reached"></a> `limit_reached` | `boolean` | Remaining cap cannot fund the minimum automatic reload charge. |
| <a id="property-resets_at"></a> `resets_at` | `string` | Start of the next UTC calendar month, independently of subscription renewal. |
