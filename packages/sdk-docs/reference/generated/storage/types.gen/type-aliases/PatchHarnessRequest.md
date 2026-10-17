# Type Alias: PatchHarnessRequest

> **PatchHarnessRequest** = \{ `allow_permission_bypass?`: `boolean` \| `null`; \}

Request to change a registered harness.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-allow_permission_bypass"></a> `allow_permission_bypass?` | `boolean` \| `null` | Whether agents may bypass ACP permission requests on this harness. Enabling requires the machine operator's reported consent. |
