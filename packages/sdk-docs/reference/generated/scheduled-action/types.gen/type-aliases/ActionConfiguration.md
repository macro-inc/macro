# Type Alias: ActionConfiguration

> **ActionConfiguration** = \{ `enabled`: `boolean`; `kind`: [`ActionKind`](ActionKind.md); `name`: `string`; `run_visibility?`: [`RunVisibility`](RunVisibility.md); `task`: \{\[`key`: `string`\]: `unknown`; \}; `trigger`: [`ActionTrigger`](ActionTrigger.md); \}

Canonical client configuration. Ownership and execution state are server-owned.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-enabled"></a> `enabled` | `boolean` | - |
| <a id="property-kind"></a> `kind` | [`ActionKind`](ActionKind.md) | - |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-run_visibility"></a> `run_visibility?` | [`RunVisibility`](RunVisibility.md) | Omitted by clients that predate the setting; runs then start unlisted. |
| <a id="property-task"></a> `task` | \{\[`key`: `string`\]: `unknown`; \} | - |
| <a id="property-trigger"></a> `trigger` | [`ActionTrigger`](ActionTrigger.md) | - |
