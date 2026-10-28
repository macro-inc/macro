# Type Alias: CreateCheckoutSessionV2Request

> **CreateCheckoutSessionV2Request** = \{ `cancelUrl`: `string`; `discount?`: `string` \| `null`; `metadata?`: [`CheckoutSessionMetadata`](CheckoutSessionMetadata.md); `onboardingTrial?`: `boolean`; `plan?`: `null` \| [`SeatPlan`](SeatPlan.md); `successUrl`: `string`; \}

Request body for creating a Stripe checkout session

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-cancelurl"></a> `cancelUrl` | `string` | The URL to redirect to if checkout is cancelled |
| <a id="property-discount"></a> `discount?` | `string` \| `null` | Optional discount/promo code to apply |
| <a id="property-metadata"></a> `metadata?` | [`CheckoutSessionMetadata`](CheckoutSessionMetadata.md) | Tracking metadata for conversion attribution |
| <a id="property-onboardingtrial"></a> `onboardingTrial?` | `boolean` | Request the automatic, first-subscription 30-day Premium trial. |
| <a id="property-plan"></a> `plan?` | `null` \| [`SeatPlan`](SeatPlan.md) | - |
| <a id="property-successurl"></a> `successUrl` | `string` | The URL to redirect to on successful checkout |
