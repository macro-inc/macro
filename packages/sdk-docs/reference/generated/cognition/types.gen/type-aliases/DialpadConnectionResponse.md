# Type Alias: DialpadConnectionResponse

> **DialpadConnectionResponse** = \{ `issue?`: `null` \| [`DialpadSyncIssue`](DialpadSyncIssue.md); `lastSyncedAt?`: `string` \| `null`; `state`: [`DialpadConnectionState`](DialpadConnectionState.md); \}

The user's Dialpad call sync.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-issue"></a> `issue?` | `null` \| [`DialpadSyncIssue`](DialpadSyncIssue.md) | - |
| <a id="property-lastsyncedat"></a> `lastSyncedAt?` | `string` \| `null` | When a call last synced. |
| <a id="property-state"></a> `state` | [`DialpadConnectionState`](DialpadConnectionState.md) | Where sync stands. |
