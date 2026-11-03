# Type Alias: SessionAutoArchiveResponse

> **SessionAutoArchiveResponse** = \{ `autoArchivedAt?`: `string` \| `null`; `defaults`: [`AutoArchivePreferencesBody`](AutoArchivePreferencesBody.md); `overrides`: [`AutoArchiveOverridesBody`](AutoArchiveOverridesBody.md); \}

A session's auto-archive settings and history.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-autoarchivedat"></a> `autoArchivedAt?` | `string` \| `null` | When a trigger first archived the session. Kept when a person restores it: a session archives itself at most once. |
| <a id="property-defaults"></a> `defaults` | [`AutoArchivePreferencesBody`](AutoArchivePreferencesBody.md) | The owner's defaults, which apply where the session has no choice of its own. |
| <a id="property-overrides"></a> `overrides` | [`AutoArchiveOverridesBody`](AutoArchiveOverridesBody.md) | The session's own choices. |
