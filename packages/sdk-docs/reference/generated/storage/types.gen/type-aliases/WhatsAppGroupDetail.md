# Type Alias: WhatsAppGroupDetail

> **WhatsAppGroupDetail** = [`WhatsAppGroupSummary`](WhatsAppGroupSummary.md) & \{ `access_level`: [`AccessLevel`](AccessLevel.md); `limits`: [`LinkedCapabilities`](LinkedCapabilities.md); `roster?`: `null` \| [`LinkedGroupInfo`](LinkedGroupInfo.md); `sending_identity?`: `string` \| `null`; `share_permission`: [`SharePermissionV2`](SharePermissionV2.md); \}

Full group detail and current viewer capabilities.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `access_level` | [`AccessLevel`](AccessLevel.md) | Caller's effective permission. |
| `limits` | [`LinkedCapabilities`](LinkedCapabilities.md) | Size and mutation limits. |
| `roster?` | `null` \| [`LinkedGroupInfo`](LinkedGroupInfo.md) | - |
| `sending_identity?` | `string` \| `null` | Caller's own phone identity, never another account's identity. |
| `share_permission` | [`SharePermissionV2`](SharePermissionV2.md) | Owner-controlled standard sharing configuration. |
