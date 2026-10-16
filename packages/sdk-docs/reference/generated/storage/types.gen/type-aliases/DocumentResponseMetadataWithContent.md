# Type Alias: DocumentResponseMetadataWithContent

> **DocumentResponseMetadataWithContent** = [`DocumentResponseMetadata`](DocumentResponseMetadata.md) & \{ `content`: [`DocumentContent`](DocumentContent.md); `teamId?`: `string` \| `null`; `teamTaskId?`: `number` \| `null`; \}

Create/copy response metadata plus content lifecycle metadata.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `content` | [`DocumentContent`](DocumentContent.md) | Content lifecycle and location metadata. |
| `teamId?` | `string` \| `null` | The team this task number is scoped to, for task documents. |
| `teamTaskId?` | `number` \| `null` | The task number assigned within the team, for task documents. |
