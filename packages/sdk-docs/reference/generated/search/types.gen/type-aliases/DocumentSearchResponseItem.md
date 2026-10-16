# Type Alias: DocumentSearchResponseItem

> **DocumentSearchResponseItem** = \{ `document_id`: `string`; `document_name`: `string`; `document_search_results`: [`DocumentSearchResult`](DocumentSearchResult.md)[]; `file_type?`: `string` \| `null`; `id`: `string`; `name`: `string`; `owner_id`: `string`; `sub_type?`: `null` \| [`DocumentSubType`](DocumentSubType.md); \}

A single response item, part of the DocumentSearchResponse object

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-document_id"></a> `document_id` | `string` | The id of the document |
| <a id="property-document_name"></a> `document_name` | `string` | The name of the document |
| <a id="property-document_search_results"></a> `document_search_results` | [`DocumentSearchResult`](DocumentSearchResult.md)[] | The search results for the document This may be empty if the search result match was on the document name only |
| <a id="property-file_type"></a> `file_type?` | `string` \| `null` | The file type of the document |
| <a id="property-id"></a> `id` | `string` | Standardized fields that all item types will share. These field names are being aligned across all item types for consistency in our data model. |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-owner_id"></a> `owner_id` | `string` | - |
| <a id="property-sub_type"></a> `sub_type?` | `null` \| [`DocumentSubType`](DocumentSubType.md) | - |
