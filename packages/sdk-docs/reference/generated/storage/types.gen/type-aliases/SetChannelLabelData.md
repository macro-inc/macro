# Type Alias: SetChannelLabelData

> **SetChannelLabelData** = \{ `body`: [`SetChannelLabelRequest`](SetChannelLabelRequest.md); `path`: \{ `channel_id`: `string`; \}; `query?`: \{ `scope?`: [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md); \}; `url`: `"/channel-labels/channels/{channel_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SetChannelLabelRequest`](SetChannelLabelRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `channel_id`: `string`; \} | - |
| `path.channel_id` | `string` | The channel id. |
| <a id="property-query"></a> `query?` | \{ `scope?`: [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md); \} | - |
| `query.scope?` | [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md) | `personal` selects private labels; `team` requires team membership. |
| <a id="property-url"></a> `url` | `"/channel-labels/channels/{channel_id}"` | - |
