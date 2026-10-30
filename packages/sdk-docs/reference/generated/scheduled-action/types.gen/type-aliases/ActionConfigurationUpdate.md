# Type Alias: ActionConfigurationUpdate

> **ActionConfigurationUpdate** = \{ `enabled?`: `boolean` \| `null`; `kind`: [`ActionKind`](ActionKind.md); `name`: `string`; `run_visibility?`: `null` \| [`RunVisibility`](RunVisibility.md); `task`: \{\[`key`: `string`\]: `unknown`; \}; `trigger`: [`ActionTrigger`](ActionTrigger.md); \}

Canonical configuration replacement. Activation has its own endpoint, so
omitting `enabled` keeps the stored value; omitting `run_visibility` keeps
it too, so clients that predate the setting do not reset it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-enabled"></a> ~~`enabled?`~~ | `boolean` \| `null` | Still sent by clients deployed before the activation endpoint. **Deprecated** |
| <a id="property-kind"></a> `kind` | [`ActionKind`](ActionKind.md) | - |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-run_visibility"></a> `run_visibility?` | `null` \| [`RunVisibility`](RunVisibility.md) | - |
| <a id="property-task"></a> `task` | \{\[`key`: `string`\]: `unknown`; \} | - |
| <a id="property-trigger"></a> `trigger` | [`ActionTrigger`](ActionTrigger.md) | - |
