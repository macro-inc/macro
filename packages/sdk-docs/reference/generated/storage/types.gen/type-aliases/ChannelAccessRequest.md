# Type Alias: ChannelAccessRequest

> **ChannelAccessRequest** = \{ `channel_id`: `string`; `created_at`: `string`; `id`: `string`; `requester_id`: [`MacroUserIdStr`](MacroUserIdStr.md); `resolved_at?`: `string` \| `null`; `resolved_by?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); `status`: [`ChannelAccessRequestStatus`](ChannelAccessRequestStatus.md); \}

One attempt to join a channel. Attempts are never reused, so each timeline
entry keeps showing the outcome of the attempt it announced.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel the requester asked to join. |
| <a id="property-created_at"></a> `created_at` | `string` | When the requester asked. |
| <a id="property-id"></a> `id` | `string` | Attempt id. |
| <a id="property-requester_id"></a> `requester_id` | [`MacroUserIdStr`](MacroUserIdStr.md) | Person asking to join. |
| <a id="property-resolved_at"></a> `resolved_at?` | `string` \| `null` | When the attempt stopped being pending. |
| <a id="property-resolved_by"></a> `resolved_by?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
| <a id="property-status"></a> `status` | [`ChannelAccessRequestStatus`](ChannelAccessRequestStatus.md) | Current outcome. |
