# Type Alias: PatchWebhookRequest

> **PatchWebhookRequest** = \{ `endpoint_url?`: `string` \| `null`; `filters?`: `null` \| [`Vec`](Vec.md); `headers?`: `null` \| [`BTreeMap`](BTreeMap.md); `name?`: `string` \| `null`; `status?`: `null` \| [`WebhookStatus`](WebhookStatus.md); \}

Request to patch a webhook. The webhook's namespace is fixed at creation
time and is deliberately not patchable.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-endpoint_url"></a> `endpoint_url?` | `string` \| `null` | Endpoint URL. HTTPS is required outside local environments. |
| <a id="property-filters"></a> `filters?` | `null` \| [`Vec`](Vec.md) | - |
| <a id="property-headers"></a> `headers?` | `null` \| [`BTreeMap`](BTreeMap.md) | - |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name. |
| <a id="property-status"></a> `status?` | `null` \| [`WebhookStatus`](WebhookStatus.md) | - |
