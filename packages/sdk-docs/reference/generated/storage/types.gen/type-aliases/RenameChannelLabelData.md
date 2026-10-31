# Type Alias: RenameChannelLabelData

> **RenameChannelLabelData** = \{ `body`: [`RenameChannelLabelRequest`](RenameChannelLabelRequest.md); `path`: \{ `label_id`: `string`; \}; `query?`: \{ `scope?`: [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md); \}; `url`: `"/channel-labels/{label_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`RenameChannelLabelRequest`](RenameChannelLabelRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `label_id`: `string`; \} | - |
| `path.label_id` | `string` | The label id. |
| <a id="property-query"></a> `query?` | \{ `scope?`: [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md); \} | - |
| `query.scope?` | [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md) | `personal` selects private labels; `team` requires team membership. |
| <a id="property-url"></a> `url` | `"/channel-labels/{label_id}"` | - |
