# Type Alias: CreateWebhookRequest

> **CreateWebhookRequest** = \{ `endpoint_url`: `string`; `filters`: [`Vec`](Vec.md); `headers?`: `null` \| [`BTreeMap`](BTreeMap.md); `name`: `string`; `namespace`: `string`; `scope`: [`WebhookScope`](WebhookScope.md); \}

Request to create a webhook.

Clients serialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-endpoint_url"></a> `endpoint_url` | `string` | Endpoint URL. HTTPS is required outside local environments. |
| <a id="property-filters"></a> `filters` | [`Vec`](Vec.md) | Typed filters used to match events and optional entity ids. |
| <a id="property-headers"></a> `headers?` | `null` \| [`BTreeMap`](BTreeMap.md) | - |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-namespace"></a> `namespace` | `string` | Caller-chosen namespace, unique among the owning workspace's webhooks. Set at creation time only; it cannot be changed afterwards. |
| <a id="property-scope"></a> `scope` | [`WebhookScope`](WebhookScope.md) | Scope that owns the webhook. |
