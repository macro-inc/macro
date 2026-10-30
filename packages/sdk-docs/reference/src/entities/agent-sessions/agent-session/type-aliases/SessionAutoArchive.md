# Type Alias: SessionAutoArchive

> **SessionAutoArchive** = \{ `archived?`: \{ `archivedAt`: `string`; `reason`: [`AutoArchiveReason`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchiveReason.md); `restoredAt?`: `string`; \}; `defaults`: [`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md); `overrides`: [`AutoArchiveOverrides`](AutoArchiveOverrides.md); \}

A session's auto-archive settings, and the archive a trigger made.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-archived"></a> `archived?` | \{ `archivedAt`: `string`; `reason`: [`AutoArchiveReason`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchiveReason.md); `restoredAt?`: `string`; \} | The archive a trigger made, if one did. A session archives itself at most once; `restoredAt` is set once a person restored it. |
| `archived.archivedAt` | `string` | - |
| `archived.reason` | [`AutoArchiveReason`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchiveReason.md) | - |
| `archived.restoredAt?` | `string` | - |
| <a id="property-defaults"></a> `defaults` | [`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md) | The owner's defaults, which apply where the session has no choice. |
| <a id="property-overrides"></a> `overrides` | [`AutoArchiveOverrides`](AutoArchiveOverrides.md) | The session's own choices. |
