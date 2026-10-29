# Type Alias: ApiChannelListParticipant

> **ApiChannelListParticipant** = \{ `channel_id`: `string`; `joined_at`: `string`; `left_at?`: `string` \| `null`; `role`: [`ApiParticipantListRole`](ApiParticipantListRole.md); `user_id`: `string`; \}

Channel participant in API responses.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | id of the channel |
| <a id="property-joined_at"></a> `joined_at` | `string` | timestamp of when the user joined the channel |
| <a id="property-left_at"></a> `left_at?` | `string` \| `null` | timestamp of when the user left the channel |
| <a id="property-role"></a> `role` | [`ApiParticipantListRole`](ApiParticipantListRole.md) | type of the participant |
| <a id="property-user_id"></a> `user_id` | `string` | id of the user |
