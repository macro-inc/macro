# Type Alias: ExternalChatDetail

> **ExternalChatDetail** = [`ExternalChatSummary`](ExternalChatSummary.md) & \{ `accessLevel`: [`AccessLevel`](AccessLevel.md); `disappearingSeconds?`: `number` \| `null`; `limits`: [`ExternalChatCapabilities`](ExternalChatCapabilities.md); `members?`: `null` \| [`ExternalChatMembers`](ExternalChatMembers.md); `sendingIdentity?`: `string` \| `null`; `sharePermission`: [`SharePermissionV2`](SharePermissionV2.md); \}

Full chat detail and current viewer capabilities.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `accessLevel` | [`AccessLevel`](AccessLevel.md) | Caller's effective permission. |
| `disappearingSeconds?` | `number` \| `null` | The provider's disappearing-messages timer in seconds while it is on; Macro keeps the messages anyway. `null` when off or unknown. |
| `limits` | [`ExternalChatCapabilities`](ExternalChatCapabilities.md) | Size and mutation limits. |
| `members?` | `null` \| [`ExternalChatMembers`](ExternalChatMembers.md) | - |
| `sendingIdentity?` | `string` \| `null` | Caller's own phone identity, never another account's identity. |
| `sharePermission` | [`SharePermissionV2`](SharePermissionV2.md) | Owner-controlled standard sharing configuration. |
