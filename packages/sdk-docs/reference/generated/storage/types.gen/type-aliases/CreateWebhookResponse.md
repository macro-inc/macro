# Type Alias: CreateWebhookResponse

> **CreateWebhookResponse** = \{ `created_at`: `string`; `created_by_user_id`: `string`; `deleted_at?`: `string` \| `null`; `endpoint_url`: `string`; `filters`: [`Vec`](Vec.md); `headers`: [`BTreeMap`](BTreeMap.md); `id`: [`String`](String.md); `is_valid`: `boolean`; `name`: `string`; `namespace`: `string`; `signing_secret`: `string`; `status`: [`WebhookStatus`](WebhookStatus.md); `updated_at`: `string`; `workspace_id`: `string`; \}

Webhook returned after creation, including its signing secret.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at"></a> `created_at` | `string` | Creation timestamp. |
| <a id="property-created_by_user_id"></a> `created_by_user_id` | `string` | User that created the webhook. |
| <a id="property-deleted_at"></a> `deleted_at?` | `string` \| `null` | Soft-delete timestamp. |
| <a id="property-endpoint_url"></a> `endpoint_url` | `string` | Endpoint URL. HTTPS is required outside local environments. |
| <a id="property-filters"></a> `filters` | [`Vec`](Vec.md) | Typed filters used to match events and optional entity ids. |
| <a id="property-headers"></a> `headers` | [`BTreeMap`](BTreeMap.md) | Custom delivery headers, after decryption by the repository. |
| <a id="property-id"></a> `id` | [`String`](String.md) | Webhook id. |
| <a id="property-is_valid"></a> `is_valid` | `boolean` | Whether the current endpoint configuration has passed validation. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-namespace"></a> `namespace` | `string` | Caller-chosen namespace, unique among the owning workspace's webhooks. Set at creation time only; it cannot be changed afterwards. |
| <a id="property-signing_secret"></a> `signing_secret` | `string` | Signing secret used to verify webhook delivery signatures. |
| <a id="property-status"></a> `status` | [`WebhookStatus`](WebhookStatus.md) | Webhook lifecycle status. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Update timestamp. |
| <a id="property-workspace_id"></a> `workspace_id` | `string` | Owning workspace id. |
