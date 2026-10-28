# Type Alias: CheckoutSessionV2Response

> **CheckoutSessionV2Response** = \{ `trialDays?`: `number` \| `null`; `url`: `string`; \}

Hosted checkout with the billing terms the server actually granted.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-trialdays"></a> `trialDays?` | `number` \| `null` | Trial duration, absent for an immediately paid checkout. |
| <a id="property-url"></a> `url` | `string` | The opaque URL returned by Stripe. |
