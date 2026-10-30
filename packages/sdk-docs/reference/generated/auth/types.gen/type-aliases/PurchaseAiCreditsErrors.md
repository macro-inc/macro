# Type Alias: PurchaseAiCreditsErrors

> **PurchaseAiCreditsErrors** = \{ `400`: [`AiBillingErrorBody`](AiBillingErrorBody.md); `401`: `unknown`; `402`: [`AiBillingErrorBody`](AiBillingErrorBody.md); `409`: [`AiBillingErrorBody`](AiBillingErrorBody.md); `500`: [`AiBillingErrorBody`](AiBillingErrorBody.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-400"></a> `400` | [`AiBillingErrorBody`](AiBillingErrorBody.md) | Invalid pack or no payment account |
| <a id="property-401"></a> `401` | `unknown` | Unauthorized |
| <a id="property-402"></a> `402` | [`AiBillingErrorBody`](AiBillingErrorBody.md) | A paid plan is required |
| <a id="property-409"></a> `409` | [`AiBillingErrorBody`](AiBillingErrorBody.md) | Over the monthly credit limit, or an earlier purchase is still processing |
| <a id="property-500"></a> `500` | [`AiBillingErrorBody`](AiBillingErrorBody.md) | Internal server error |
