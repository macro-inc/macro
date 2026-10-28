# Type Alias: PairingDetails

> **PairingDetails** = \{ `code`: `string`; `created_at`: `string`; `expires_at`: `string`; `host?`: `string` \| `null`; `requested_allow_permission_bypass?`: `boolean` \| `null`; `requested_name`: `string`; `requested_scope?`: `null` \| [`RequestedHarnessScope`](RequestedHarnessScope.md); \}

A pending pairing, as shown to the approving user.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | `string` | The pairing code, normalized to `XXXX-XXXX`. |
| <a id="property-created_at"></a> `created_at` | `string` | When the pairing was created. |
| <a id="property-expires_at"></a> `expires_at` | `string` | When the pairing expires. |
| <a id="property-host"></a> `host?` | `string` \| `null` | Display-only description of the machine. |
| <a id="property-requested_allow_permission_bypass"></a> `requested_allow_permission_bypass?` | `boolean` \| `null` | Daemon operator consent ceiling; false forbids bypass at approval. |
| <a id="property-requested_name"></a> `requested_name` | `string` | Harness display name the daemon asked for. |
| <a id="property-requested_scope"></a> `requested_scope?` | `null` \| [`RequestedHarnessScope`](RequestedHarnessScope.md) | - |
