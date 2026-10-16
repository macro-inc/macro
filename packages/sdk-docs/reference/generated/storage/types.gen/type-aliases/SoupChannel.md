# Type Alias: SoupChannel

> **SoupChannel** = [`ChannelWithParticipants`](ChannelWithParticipants.md) & [`LatestMessage`](LatestMessage.md) & \{ `interacted_at?`: `string` \| `null`; `viewed_at?`: `string` \| `null`; \}

A channel as displayed in Soup.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `interacted_at?` | `string` \| `null` | Timestamp when the requesting user last interacted with this channel. |
| `viewed_at?` | `string` \| `null` | Timestamp when the requesting user last viewed this channel. |
