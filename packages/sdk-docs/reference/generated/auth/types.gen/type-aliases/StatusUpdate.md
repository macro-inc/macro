# Type Alias: StatusUpdate

> **StatusUpdate** = [`SystemStatus`](SystemStatus.md) & \{ `createdAt`: `string`; `id`: `string`; `userId`: `string`; \}

One status a staff member set. The newest is the current status.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `createdAt` | `string` | When it was set. |
| `id` | `string` | UUIDv7, so ids sort by creation. |
| `userId` | `string` | The staff member who set it. |
