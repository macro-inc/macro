# Type Alias: ChannelAccessRequestedMetadata

> **ChannelAccessRequestedMetadata** = \{ `channel_id`: `string`; `request_id`: `string`; `requester_id`: [`MacroUserIdStr`](MacroUserIdStr.md); \}

Metadata for [`ChannelTopicEvent::AccessRequested`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel the requester asked to join. |
| <a id="property-request_id"></a> `request_id` | `string` | The attempt; channel participants read its current outcome by id. |
| <a id="property-requester_id"></a> `requester_id` | [`MacroUserIdStr`](MacroUserIdStr.md) | Person asking to join. |
