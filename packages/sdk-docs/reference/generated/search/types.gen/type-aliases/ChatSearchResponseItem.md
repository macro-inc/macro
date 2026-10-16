# Type Alias: ChatSearchResponseItem

> **ChatSearchResponseItem** = \{ `chat_id`: `string`; `chat_search_results`: [`ChatMessageSearchResult`](ChatMessageSearchResult.md)[]; `id`: `string`; `name`: `string`; `owner_id`: `string`; `user_id`: `string`; \}

A single response item, part of the ChatSearchResponse object

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chat_id"></a> `chat_id` | `string` | The id of the chat |
| <a id="property-chat_search_results"></a> `chat_search_results` | [`ChatMessageSearchResult`](ChatMessageSearchResult.md)[] | The search results for the chat This may be empty if the search result match was on the chat title only |
| <a id="property-id"></a> `id` | `string` | Standardized fields that all item types will share. These field names are being aligned across all item types for consistency in our data model. |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-owner_id"></a> `owner_id` | `string` | - |
| <a id="property-user_id"></a> `user_id` | `string` | The id of the creator of the chat |
