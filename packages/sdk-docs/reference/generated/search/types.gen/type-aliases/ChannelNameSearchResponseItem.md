# Type Alias: ChannelNameSearchResponseItem

> **ChannelNameSearchResponseItem** = \{ `channel_id`: `string`; `channel_type`: `string`; `highlight`: [`SearchHighlight`](SearchHighlight.md); `id`: `string`; `metadata?`: `null` \| [`ChannelMetadata`](ChannelMetadata.md); `owner_id?`: `string` \| `null`; `score?`: `number` \| `null`; \}

A channel-name search hit.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | The channel id. |
| <a id="property-channel_type"></a> `channel_type` | `string` | The type of channel. |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The matched channel-name highlight. |
| <a id="property-id"></a> `id` | `string` | Standardized id field shared by all item types; the channel id. |
| <a id="property-metadata"></a> `metadata?` | `null` \| [`ChannelMetadata`](ChannelMetadata.md) | - |
| <a id="property-owner_id"></a> `owner_id?` | `string` \| `null` | The channel owner. |
| <a id="property-score"></a> `score?` | `number` \| `null` | The score of the result. |
