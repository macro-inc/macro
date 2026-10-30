# Type Alias: CreditPurchaseResponse

> **CreditPurchaseResponse** = \{ `amountCents`: `number`; `snapshot`: [`UsageSnapshot`](UsageSnapshot.md); `status`: [`CreditPurchaseStatus`](CreditPurchaseStatus.md); \}

Response for [`purchase_credits_handler`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amountcents"></a> `amountCents` | `number` | Amount charged, cents. A retry of an earlier declined purchase charges that purchase's amount. |
| <a id="property-snapshot"></a> `snapshot` | [`UsageSnapshot`](UsageSnapshot.md) | The caller's position after the purchase. |
| <a id="property-status"></a> `status` | [`CreditPurchaseStatus`](CreditPurchaseStatus.md) | Whether the card on file paid. |
