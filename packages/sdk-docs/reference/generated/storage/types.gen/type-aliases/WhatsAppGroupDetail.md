# Type Alias: WhatsAppGroupDetail

> **WhatsAppGroupDetail** = [`WhatsAppGroupSummary`](WhatsAppGroupSummary.md) & \{ `access_level`: [`AccessLevel`](AccessLevel.md); `community?`: `null` \| [`LinkedCommunityReference`](LinkedCommunityReference.md); `disappearing_seconds?`: `number` \| `null`; `limits`: [`LinkedCapabilities`](LinkedCapabilities.md); `roster?`: `null` \| [`LinkedGroupInfo`](LinkedGroupInfo.md); `sending_identity?`: `string` \| `null`; `share_permission`: [`SharePermissionV2`](SharePermissionV2.md); \}

Full group detail and current viewer capabilities.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `access_level` | [`AccessLevel`](AccessLevel.md) | Caller's effective permission. |
| `community?` | `null` \| [`LinkedCommunityReference`](LinkedCommunityReference.md) | - |
| `disappearing_seconds?` | `number` \| `null` | WhatsApp's disappearing-messages timer in seconds while it is on; Macro keeps the messages anyway. `null` when off or unknown. |
| `limits` | [`LinkedCapabilities`](LinkedCapabilities.md) | Size and mutation limits. |
| `roster?` | `null` \| [`LinkedGroupInfo`](LinkedGroupInfo.md) | - |
| `sending_identity?` | `string` \| `null` | Caller's own phone identity, never another account's identity. |
| `share_permission` | [`SharePermissionV2`](SharePermissionV2.md) | Owner-controlled standard sharing configuration. |
