# Type Alias: ChannelLabelsList

> **ChannelLabelsList** = \{ `labels`: [`ChannelLabel`](ChannelLabel.md)[]; `teamId?`: `string` \| `null`; \}

The authorized scope's labels in manual order.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-labels"></a> `labels` | [`ChannelLabel`](ChannelLabel.md)[] | Every label of the scope, whether or not the caller sees channels in it. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | Team scope, or `None` for private labels. |
