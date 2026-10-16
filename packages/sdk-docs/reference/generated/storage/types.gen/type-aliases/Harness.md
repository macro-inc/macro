# Type Alias: Harness

> **Harness** = \{ `allow_permission_bypass?`: `boolean`; `connected`: `boolean`; `created_at`: `string`; `created_by`: `string`; `id`: [`HarnessId`](HarnessId.md); `kind`: `string`; `last_connected_at?`: `string` \| `null`; `name`: `string`; `owner`: [`HarnessOwner`](HarnessOwner.md); `updated_at`: `string`; \}

A registered user-run harness.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-allow_permission_bypass"></a> `allow_permission_bypass?` | `boolean` | Whether agents may bypass ACP permission requests on this harness. |
| <a id="property-connected"></a> `connected` | `boolean` | Whether the daemon currently holds a runtime connection. |
| <a id="property-created_at"></a> `created_at` | `string` | Creation timestamp. |
| <a id="property-created_by"></a> `created_by` | `string` | User that registered this harness. |
| <a id="property-id"></a> `id` | [`HarnessId`](HarnessId.md) | Harness id. |
| <a id="property-kind"></a> `kind` | `string` | Runtime kind. Currently always `macrod`. |
| <a id="property-last_connected_at"></a> `last_connected_at?` | `string` \| `null` | When the daemon last attached a runtime connection. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-owner"></a> `owner` | [`HarnessOwner`](HarnessOwner.md) | Owner. |
| <a id="property-updated_at"></a> `updated_at` | `string` | Update timestamp. |
