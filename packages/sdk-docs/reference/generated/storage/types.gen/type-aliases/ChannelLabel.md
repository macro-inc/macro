# Type Alias: ChannelLabel

> **ChannelLabel** = \{ `channelCount`: `number`; `channelIds`: `string`[]; `createdAt`: `string`; `id`: `string`; `name`: `string`; `rule?`: `null` \| [`ChannelLabelRule`](ChannelLabelRule.md); `sortOrder`: `number`; `teamId?`: `string` \| `null`; `updatedAt`: `string`; \}

A shared or account-private label grouping chat channels in the sidebar.

`channel_ids` is viewer-relative: it lists only the labelled channels the
requesting user participates in. `channel_count` counts every channel in
the label so clients can warn accurately before a delete.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelcount"></a> `channelCount` | `number` | All assignments for a manual label; visible matches for a smart tag. |
| <a id="property-channelids"></a> `channelIds` | `string`[] | Channels in this label that the requesting user participates in. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the label was created. |
| <a id="property-id"></a> `id` | `string` | Stable label id. |
| <a id="property-name"></a> `name` | `string` | Display name, unique within the scope (case-insensitive). |
| <a id="property-rule"></a> `rule?` | `null` \| [`ChannelLabelRule`](ChannelLabelRule.md) | - |
| <a id="property-sortorder"></a> `sortOrder` | `number` | Manual ordering value within the scope; lower sorts first. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | Owning team, or `None` for account-private labels. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | When the label was last renamed or reordered. |
