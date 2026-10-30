# Type Alias: PatchHarnessRequest

> **PatchHarnessRequest** = \{ `allow_permission_bypass?`: `boolean` \| `null`; `name?`: `string` \| `null`; \}

Request to change a registered harness. Omitted fields stay as they are.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-allow_permission_bypass"></a> `allow_permission_bypass?` | `boolean` \| `null` | Whether agents may bypass ACP permission requests on this harness. Live sessions pick the change up at their next turn. |
| <a id="property-name"></a> `name?` | `string` \| `null` | New display name. |
