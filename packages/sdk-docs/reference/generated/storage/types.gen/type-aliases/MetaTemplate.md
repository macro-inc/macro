# Type Alias: MetaTemplate

> **MetaTemplate** = \{ `category?`: `string` \| `null`; `components`: `unknown`; `id`: [`MetaProviderId`](MetaProviderId.md); `language`: `string`; `name`: `string`; `parameter_labels`: `string`[]; `unsupported_reason?`: `string` \| `null`; \}

An approved WhatsApp template returned from this connection's account.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-category"></a> `category?` | `string` \| `null` | Provider category; authentication templates cannot be sent to groups. |
| <a id="property-components"></a> `components` | `unknown` | Approved components used for preview/parameter collection. |
| <a id="property-id"></a> `id` | [`MetaProviderId`](MetaProviderId.md) | Provider template identity. |
| <a id="property-language"></a> `language` | `string` | Exact approved language code. |
| <a id="property-name"></a> `name` | `string` | Exact approved name. |
| <a id="property-parameter_labels"></a> `parameter_labels` | `string`[] | Ordered text inputs, including the component and any named variable. |
| <a id="property-unsupported_reason"></a> `unsupported_reason?` | `string` \| `null` | Nonempty when this approved template needs inputs this composer cannot supply. |
