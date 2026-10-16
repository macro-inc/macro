# Type Alias: ApprovePairingRequest

> **ApprovePairingRequest** = \{ `allow_permission_bypass?`: `boolean`; `name?`: `string` \| `null`; `team_id?`: `string` \| `null`; \}

Request to approve a pairing and register the harness.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-allow_permission_bypass"></a> `allow_permission_bypass?` | `boolean` | Whether agents may bypass ACP permission requests on this harness. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name override. Defaults to the daemon's requested name. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | Owning team. Omit for a private, user-owned harness. |
