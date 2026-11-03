# Type Alias: SessionAutoArchive

> **SessionAutoArchive** = \{ `autoArchivedAt?`: `string`; `defaults`: [`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md); `overrides`: [`AutoArchiveOverrides`](AutoArchiveOverrides.md); \}

A session's auto-archive settings, and when a trigger archived it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-autoarchivedat"></a> `autoArchivedAt?` | `string` | When a trigger first archived the session, if one did. It stays after the session is unarchived, since a session archives itself at most once. |
| <a id="property-defaults"></a> `defaults` | [`AutoArchivePreferencesBody`](../../../../../generated/agent-harness/types.gen/type-aliases/AutoArchivePreferencesBody.md) | The owner's defaults, which apply where the session has no choice. |
| <a id="property-overrides"></a> `overrides` | [`AutoArchiveOverrides`](AutoArchiveOverrides.md) | The session's own choices. |
