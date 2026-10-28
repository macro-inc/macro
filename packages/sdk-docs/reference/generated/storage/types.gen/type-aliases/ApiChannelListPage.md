# Type Alias: ApiChannelListPage

> **ApiChannelListPage** = \{ `items`: [`ApiChannelWithLatest`](ApiChannelWithLatest.md)[]; `next_cursor?`: `string` \| `null`; \}

A cursor-paginated channel list response.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-items"></a> `items` | [`ApiChannelWithLatest`](ApiChannelWithLatest.md)[] | Channels in this page. |
| <a id="property-next_cursor"></a> `next_cursor?` | `string` \| `null` | Opaque cursor for the next page, if one exists. |
