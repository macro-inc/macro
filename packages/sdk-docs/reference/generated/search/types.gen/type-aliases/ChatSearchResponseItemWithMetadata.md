# Type Alias: ChatSearchResponseItemWithMetadata

> **ChatSearchResponseItemWithMetadata** = [`ChatSearchResponseItem`](ChatSearchResponseItem.md) & \{ `metadata?`: `null` \| [`ChatMetadata`](ChatMetadata.md); `properties?`: [`SoupProperty`](SoupProperty.md)[] \| `null`; \}

ChatSearchResponse object with channel metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update each chat message record for the chat
every time the chat updates (specifically for updated_at and viewed_at)

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `metadata?` | `null` \| [`ChatMetadata`](ChatMetadata.md) | - |
| `properties?` | [`SoupProperty`](SoupProperty.md)[] \| `null` | Entity properties (e.g. tags) on the chat. |
