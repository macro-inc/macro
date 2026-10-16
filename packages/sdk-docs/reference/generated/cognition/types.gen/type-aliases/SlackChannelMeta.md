# Type Alias: SlackChannelMeta

> **SlackChannelMeta** = \{ `archived?`: `boolean`; `channel_id?`: `string` \| `null`; `member_count?`: `number` \| `null`; `members_resolved?`: `boolean`; `name`: `string`; `participants?`: [`SlackParticipant`](SlackParticipant.md)[]; `purpose?`: `string` \| `null`; \}

Metadata for one staged Slack channel.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-archived"></a> `archived?` | `boolean` | Whether Slack has archived this channel. |
| <a id="property-channel_id"></a> `channel_id?` | `string` \| `null` | Slack's channel id (e.g. `C0123456789`), stable across renames. |
| <a id="property-member_count"></a> `member_count?` | `number` \| `null` | Total human members in the Slack channel. |
| <a id="property-members_resolved"></a> `members_resolved?` | `boolean` | Whether `participants` reflects a live membership read. |
| <a id="property-name"></a> `name` | `string` | Channel name without the leading `#`. |
| <a id="property-participants"></a> `participants?` | [`SlackParticipant`](SlackParticipant.md)[] | Slack members matched to the Macro team roster when discovery resolved membership. |
| <a id="property-purpose"></a> `purpose?` | `string` \| `null` | The channel's purpose/topic, when set. |
