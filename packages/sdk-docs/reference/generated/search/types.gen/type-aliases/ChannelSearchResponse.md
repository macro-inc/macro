# Type Alias: ChannelSearchResponse

> **ChannelSearchResponse** = \{ `next_cursor?`: `string` \| `null`; `results`: [`ChannelSearchResponseItemWithMetadata`](ChannelSearchResponseItemWithMetadata.md)[]; `total_count`: `number`; \}

The document search response object

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-next_cursor"></a> `next_cursor?` | `string` \| `null` | Base64-encoded cursor for the next page; `None` when exhausted. |
| <a id="property-results"></a> `results` | [`ChannelSearchResponseItemWithMetadata`](ChannelSearchResponseItemWithMetadata.md)[] | List containing results from email threads |
| <a id="property-total_count"></a> `total_count` | `number` | Total number of matching channel messages across all pages. |
