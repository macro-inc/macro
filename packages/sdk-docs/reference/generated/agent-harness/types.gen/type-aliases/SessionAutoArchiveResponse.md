# Type Alias: SessionAutoArchiveResponse

> **SessionAutoArchiveResponse** = \{ `archived?`: `null` \| [`AutoArchivedBody`](AutoArchivedBody.md); `defaults`: [`AutoArchivePreferencesBody`](AutoArchivePreferencesBody.md); `overrides`: [`AutoArchiveOverridesBody`](AutoArchiveOverridesBody.md); \}

A session's auto-archive settings and history.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-archived"></a> `archived?` | `null` \| [`AutoArchivedBody`](AutoArchivedBody.md) | - |
| <a id="property-defaults"></a> `defaults` | [`AutoArchivePreferencesBody`](AutoArchivePreferencesBody.md) | The owner's defaults, which apply where the session has no choice of its own. |
| <a id="property-overrides"></a> `overrides` | [`AutoArchiveOverridesBody`](AutoArchiveOverridesBody.md) | The session's own choices. |
