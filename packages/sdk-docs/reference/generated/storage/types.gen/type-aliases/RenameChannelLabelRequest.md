# Type Alias: RenameChannelLabelRequest

> **RenameChannelLabelRequest** = \{ `name`: `string`; `rule?`: `null` \| [`ChannelLabelRule`](ChannelLabelRule.md); `targetScope?`: `null` \| [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md); \}

Request body for updating a label's name, smart rule, or sharing scope.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | New display name. |
| <a id="property-rule"></a> `rule?` | `null` \| [`ChannelLabelRule`](ChannelLabelRule.md) | - |
| <a id="property-targetscope"></a> `targetScope?` | `null` \| [`ChannelLabelScopeSelection`](ChannelLabelScopeSelection.md) | - |
