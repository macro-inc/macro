# Type Alias: CreditPurchaseSnapshot

> **CreditPurchaseSnapshot** = \{ `committed_cents`: `number`; `monthly_limit_cents?`: `number` \| `null`; `resets_at`: `string`; \}

The monthly credit limit that applies to this user's one-time purchases.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-committed_cents"></a> `committed_cents` | `number` | Charged this month so far, including charges that may still collect. |
| <a id="property-monthly_limit_cents"></a> `monthly_limit_cents?` | `number` \| `null` | Most credits charged to the card on file per UTC calendar month, from automatic reloads and one-time purchases together, in customer cents. `null` when the payer set no limit; team members always have one. |
| <a id="property-resets_at"></a> `resets_at` | `string` | Start of the next UTC calendar month. |
