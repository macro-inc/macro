# Type Alias: CreateChannelLabelRequest

> **CreateChannelLabelRequest** = \{ `channelIds?`: `string`[]; `name`: `string`; `rule?`: `null` \| [`ChannelLabelRule`](ChannelLabelRule.md); \}

Request body for creating a label.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelids"></a> `channelIds?` | `string`[] | Channels to move into the new label. |
| <a id="property-name"></a> `name` | `string` | Display name; unique within the scope, case-insensitively. |
| <a id="property-rule"></a> `rule?` | `null` \| [`ChannelLabelRule`](ChannelLabelRule.md) | - |
