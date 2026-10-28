# Type Alias: EmailSearchResponseItem

> **EmailSearchResponseItem** = \{ `email_message_search_results`: [`EmailSearchResult`](EmailSearchResult.md)[]; `id`: `string`; `link_id`: `string`; `name?`: `string` \| `null`; `owner_id`: `string`; `participants`: [`EmailSearchParticipant`](EmailSearchParticipant.md)[]; `subject?`: `string` \| `null`; `thread_id`: `string`; `user_id`: `string`; \}

A single response item, part of the EmailSearchResponse object

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email_message_search_results"></a> `email_message_search_results` | [`EmailSearchResult`](EmailSearchResult.md)[] | The search results for the document This may be empty if the search result match was on the email subject only |
| <a id="property-id"></a> `id` | `string` | Standardized fields that all item types will share. These field names are being aligned across all item types for consistency in our data model. |
| <a id="property-link_id"></a> `link_id` | `string` | The inbox that owns the thread. Drives the multi-inbox indicator when the caller has more than one inbox. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Subject of the email thread |
| <a id="property-owner_id"></a> `owner_id` | `string` | - |
| <a id="property-participants"></a> `participants` | [`EmailSearchParticipant`](EmailSearchParticipant.md)[] | The participants (senders) in this email thread |
| <a id="property-subject"></a> `subject?` | `string` \| `null` | The subject of the email This is only present if the search result is on the message content |
| <a id="property-thread_id"></a> `thread_id` | `string` | The id of the email thread |
| <a id="property-user_id"></a> `user_id` | `string` | The id of the owner of the email thread |
