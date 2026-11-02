# Type Alias: CurrentSystemStatus

> **CurrentSystemStatus** = [`SystemStatus`](SystemStatus.md) & \{ `updatedAt?`: `string` \| `null`; \}

The status every user sees, without who set it.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `updatedAt?` | `string` \| `null` | When it was set; absent when no status was ever set. Clients keep the newest status they have seen, whether fetched or pushed. |
