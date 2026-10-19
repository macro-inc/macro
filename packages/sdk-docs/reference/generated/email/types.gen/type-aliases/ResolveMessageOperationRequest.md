# Type Alias: ResolveMessageOperationRequest

> **ResolveMessageOperationRequest** = \{ `accept_duplicate_risk?`: `boolean`; `action`: [`ApiMessageResolutionAction`](ApiMessageResolutionAction.md); `remote_version?`: `string` \| `null`; `revision`: `string`; \}

Stale versions fail without altering the current operation.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accept_duplicate_risk"></a> `accept_duplicate_risk?` | `boolean` |
| <a id="property-action"></a> `action` | [`ApiMessageResolutionAction`](ApiMessageResolutionAction.md) |
| <a id="property-remote_version"></a> `remote_version?` | `string` \| `null` |
| <a id="property-revision"></a> `revision` | `string` |
