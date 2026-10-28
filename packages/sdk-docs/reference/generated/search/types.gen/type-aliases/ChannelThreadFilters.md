# Type Alias: ChannelThreadFilters

> **ChannelThreadFilters** = \{ `channel_ids?`: `string`[]; `participant_ids?`: `string`[]; `root_sender_ids?`: `string`[]; `thread_ids?`: `string`[]; \}

The channel thread filters used to filter down channel-thread entities.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_ids"></a> `channel_ids?` | `string`[] | Channel IDs containing the thread. Empty to include threads from all accessible channels. |
| <a id="property-participant_ids"></a> `participant_ids?` | `string`[] | Thread participant user IDs. A participant is the root message sender, anyone who replied in the thread, or anyone @-mentioned in the thread (group mentions like **Here** count through their per-user expansion at send time). Empty to include threads regardless of participants. |
| <a id="property-root_sender_ids"></a> `root_sender_ids?` | `string`[] | Sender IDs for the root thread message. Empty to include all root senders. |
| <a id="property-thread_ids"></a> `thread_ids?` | `string`[] | Channel thread parent message IDs to include. Empty to include all accessible threads. |
