# Type Alias: ChannelSearchResponseItem

> **ChannelSearchResponseItem** = \{ `channel_id`: `string`; `channel_message_search_results`: [`ChannelSearchResult`](ChannelSearchResult.md)[]; `channel_type`: `string`; `id`: `string`; `owner_id?`: `string` \| `null`; \}

A single response item, part of the ChannelSearchResponse object

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | The id of the channel |
| <a id="property-channel_message_search_results"></a> `channel_message_search_results` | [`ChannelSearchResult`](ChannelSearchResult.md)[] | The search results for the channel This may be empty if the search result match was not on content |
| <a id="property-channel_type"></a> `channel_type` | `string` | The type of channel |
| <a id="property-id"></a> `id` | `string` | Standardized fields that all item types will share. These field names are being aligned across all item types for consistency in our data model. |
| <a id="property-owner_id"></a> `owner_id?` | `string` \| `null` | we don't store this for channels atm but keeping it here for consistency |
