# Type Alias: ProjectSearchResponseItemWithMetadata

> **ProjectSearchResponseItemWithMetadata** = [`ProjectSearchResponseItem`](ProjectSearchResponseItem.md) & \{ `metadata?`: `null` \| [`ProjectMetadata`](ProjectMetadata.md); `properties?`: [`SoupProperty`](SoupProperty.md)[] \| `null`; \}

ProjectSearchResponseItem object with project metadata we fetch from macrodb.
The index carries created_at/updated_at for ranking, but viewed_at is
per-user and deleted_at changes without a reindex, so metadata stays
database-sourced.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `metadata?` | `null` \| [`ProjectMetadata`](ProjectMetadata.md) | - |
| `properties?` | [`SoupProperty`](SoupProperty.md)[] \| `null` | Entity properties (e.g. tags) on the project. |
