# Type Alias: DocumentSearchResponseItemWithMetadata

> **DocumentSearchResponseItemWithMetadata** = [`DocumentSearchResponseItem`](DocumentSearchResponseItem.md) & \{ `metadata?`: `null` \| [`DocumentMetadata`](DocumentMetadata.md); `properties?`: [`SoupProperty`](SoupProperty.md)[] \| `null`; \}

DocumentSearchResponseItem object with document metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update document page record
every time the document updates (specifically for updated_at and viewed_at)

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `metadata?` | `null` \| [`DocumentMetadata`](DocumentMetadata.md) | - |
| `properties?` | [`SoupProperty`](SoupProperty.md)[] \| `null` | Entity properties (assignees, status, priority, etc.) for markdown documents. |
