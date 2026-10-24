# Type Alias: LinkedPairing

> **LinkedPairing** = \{ `account_id`: `string`; `expires_at`: `string`; `id`: `string`; `state`: [`LinkedPairingState`](LinkedPairingState.md); \}

Owner-bound pairing transaction, without its QR or pairing code.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-account_id"></a> `account_id` | `string` | Account being connected. |
| <a id="property-expires_at"></a> `expires_at` | `string` | Database-assigned deadline. |
| <a id="property-id"></a> `id` | `string` | One-use transaction id. |
| <a id="property-state"></a> `state` | [`LinkedPairingState`](LinkedPairingState.md) | Current state. |
