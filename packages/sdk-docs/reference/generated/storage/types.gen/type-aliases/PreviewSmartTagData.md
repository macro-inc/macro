# Type Alias: PreviewSmartTagData

> **PreviewSmartTagData** = \{ `body`: [`ChannelLabelRule`](ChannelLabelRule.md); `path?`: `never`; `query?`: \{ `scope?`: [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md); \}; `url`: `"/channel-labels/preview"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`ChannelLabelRule`](ChannelLabelRule.md) | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `scope?`: [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md); \} | - |
| `query.scope?` | [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md) | `personal` selects private labels; `team` requires team membership. |
| <a id="property-url"></a> `url` | `"/channel-labels/preview"` | - |
