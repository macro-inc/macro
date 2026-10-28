# Type Alias: ChannelSearchResponseItemWithMetadata

> **ChannelSearchResponseItemWithMetadata** = [`ChannelSearchResponseItem`](ChannelSearchResponseItem.md) & \{ `metadata?`: `null` \| [`ChannelMetadata`](ChannelMetadata.md); \}

ChannelSearchResponseItem object with channel metadata we fetch from macrodb. we don't store these
timestamps in opensearch as they would require us to update each chat message record for the chat
every time the chat updates (specifically for updated_at and viewed_at and interacted_at)

## Type Declaration

| Name | Type |
| ------ | ------ |
| `metadata?` | `null` \| [`ChannelMetadata`](ChannelMetadata.md) |
