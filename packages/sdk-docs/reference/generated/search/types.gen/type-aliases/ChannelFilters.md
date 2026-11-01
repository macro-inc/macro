# Type Alias: ChannelFilters

> **ChannelFilters** = \{ `channel_ids?`: `string`[]; `channel_types?`: `string`[]; `importance?`: `boolean` \| `null`; `is_participant?`: `boolean` \| `null`; `mentions?`: `string`[]; `notification_filters?`: [`NotificationFilters`](NotificationFilters.md); `org_id?`: `number` \| `null`; `sender_ids?`: `string`[]; `team_id?`: `string` \| `null`; `thread_ids?`: `string`[]; \}

The channel message filters used to filter down what channel messages you search over.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_ids"></a> `channel_ids?` | `string`[] | Channel IDs to search within. Examples: ['general']. Empty to search all accessible channels. |
| <a id="property-channel_types"></a> `channel_types?` | `string`[] | Channel types to filter by. Examples: ['public'], ['direct_message', 'private']. Empty to search all channel types. |
| <a id="property-importance"></a> `importance?` | `boolean` \| `null` | Filter by channel importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. |
| <a id="property-is_participant"></a> `is_participant?` | `boolean` \| `null` | Filter by whether the requesting user is an active participant of the channel. Presence of this filter also widens the candidate set to team channels of the user's teams that they have not joined, so `false` matches those channels. None to ignore (participant channels only, today's default). |
| <a id="property-mentions"></a> `mentions?` | `string`[] | Channel user mentions to search for. Examples: ['@username']. Empty if not filtering by mentions. |
| <a id="property-notification_filters"></a> `notification_filters?` | [`NotificationFilters`](NotificationFilters.md) | Filter by channel notification state. |
| <a id="property-org_id"></a> `org_id?` | `number` \| `null` | Channel organization ID to search within. Empty to ignore organization filtering. |
| <a id="property-sender_ids"></a> `sender_ids?` | `string`[] | Sender IDs to search within. Examples: ['user1']. Empty to search all accessible senders. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | Channel team ID to search within. Empty to ignore team filtering. |
| <a id="property-thread_ids"></a> `thread_ids?` | `string`[] | Channel thread IDs to search within. Examples: ['thread123']. Empty to search all threads. |
