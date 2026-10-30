# Type Alias: ChannelAccessRequestState

> **ChannelAccessRequestState** = \{ `can_request`: `boolean`; `request?`: `null` \| [`ChannelAccessRequest`](ChannelAccessRequest.md); `retry_after?`: `string` \| `null`; \}

A requester's view of their access to a channel they cannot read.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-can_request"></a> `can_request` | `boolean` | Whether this channel accepts requests. |
| <a id="property-request"></a> `request?` | `null` \| [`ChannelAccessRequest`](ChannelAccessRequest.md) | - |
| <a id="property-retry_after"></a> `retry_after?` | `string` \| `null` | Earliest time the caller may ask again, while they must wait. |
