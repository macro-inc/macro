# Type Alias: ApiMessageOperation

> **ApiMessageOperation** = \{ `issue?`: `null` \| [`ApiMessageOperationIssue`](ApiMessageOperationIssue.md); `remote_version?`: `string` \| `null`; `revision`: `string`; `state`: [`ApiMessageOperationState`](ApiMessageOperationState.md); \}

Versions are opaque decimal strings so clients never truncate an i64.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-issue"></a> `issue?` | `null` \| [`ApiMessageOperationIssue`](ApiMessageOperationIssue.md) |
| <a id="property-remote_version"></a> `remote_version?` | `string` \| `null` |
| <a id="property-revision"></a> `revision` | `string` |
| <a id="property-state"></a> `state` | [`ApiMessageOperationState`](ApiMessageOperationState.md) |
