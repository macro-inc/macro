# Type Alias: CreditPurchaseResponse

> **CreditPurchaseResponse** = \{ `amountCents`: `number`; `snapshot?`: `null` \| [`UsageSnapshot`](UsageSnapshot.md); `status`: [`CreditPurchaseStatus`](CreditPurchaseStatus.md); \}

Response for [`purchase_credits_handler`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amountcents"></a> `amountCents` | `number` | Amount charged, cents: the requested pack, unless an earlier declined purchase that Stripe collected in the meantime was booked instead. |
| <a id="property-snapshot"></a> `snapshot?` | `null` \| [`UsageSnapshot`](UsageSnapshot.md) | - |
| <a id="property-status"></a> `status` | [`CreditPurchaseStatus`](CreditPurchaseStatus.md) | Whether the card on file paid. |
