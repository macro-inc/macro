# Type Alias: CreditCheckoutRequestBody

> **CreditCheckoutRequestBody** = \{ `amountCents`: `number`; `cancelUrl`: `string`; `successUrl`: `string`; \}

Request body for [`create_credit_checkout_handler`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amountcents"></a> `amountCents` | `number` | Pack size, cents; one of the catalog's `credit_packs_cents`. |
| <a id="property-cancelurl"></a> `cancelUrl` | `string` | Where Stripe returns the user on cancel. Same rules as `success_url`. |
| <a id="property-successurl"></a> `successUrl` | `string` | Where Stripe returns the user after paying. Must be an `https` URL on the origin the request came from. |
