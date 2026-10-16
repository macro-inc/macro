# Type Alias: CreatePairingRequest

> **CreatePairingRequest** = \{ `allow_permission_bypass?`: `boolean` \| `null`; `host?`: `string` \| `null`; `name`: `string`; `scope?`: `null` \| [`RequestedHarnessScope`](RequestedHarnessScope.md); \}

Request to open a pairing: the daemon asks for a code the user approves.

The daemon serializes this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-allow_permission_bypass"></a> `allow_permission_bypass?` | `boolean` \| `null` | Daemon operator consent ceiling. Omitted by older clients; web approval decides. |
| <a id="property-host"></a> `host?` | `string` \| `null` | Display-only description of the machine, e.g. `eric@macbook / darwin`. |
| <a id="property-name"></a> `name` | `string` | Requested harness display name (typically the machine's hostname). |
| <a id="property-scope"></a> `scope?` | `null` \| [`RequestedHarnessScope`](RequestedHarnessScope.md) | - |
