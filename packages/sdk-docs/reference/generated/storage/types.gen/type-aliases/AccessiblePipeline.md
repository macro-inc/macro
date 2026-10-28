# Type Alias: AccessiblePipeline

> **AccessiblePipeline** = [`Pipeline`](Pipeline.md) & \{ `grant`: [`AccessLevel`](AccessLevel.md); \}

Metadata together with the caller's effective grant.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `grant` | [`AccessLevel`](AccessLevel.md) | Highest effective access. |
