# Type Alias: ChannelTopicEvent

> **ChannelTopicEvent** = \{ `event_type`: `"channel.picture_changed"`; `metadata`: [`ChannelPictureChangedMetadata`](ChannelPictureChangedMetadata.md); \} \| \{ `event_type`: `"channel.created"`; `metadata`: [`ChannelCreatedMetadata`](ChannelCreatedMetadata.md); \} \| \{ `event_type`: `"channel.updated"`; `metadata`: [`ChannelUpdatedMetadata`](ChannelUpdatedMetadata.md); \} \| \{ `event_type`: `"channel.deleted"`; `metadata`: [`ChannelDeletedMetadata`](ChannelDeletedMetadata.md); \} \| \{ `event_type`: `"channel.participant_added"`; `metadata`: [`ChannelParticipantAddedMetadata`](ChannelParticipantAddedMetadata.md); \} \| \{ `event_type`: `"channel.participant_removed"`; `metadata`: [`ChannelParticipantRemovedMetadata`](ChannelParticipantRemovedMetadata.md); \} \| \{ `event_type`: `"channel.access_requested"`; `metadata`: [`ChannelAccessRequestedMetadata`](ChannelAccessRequestedMetadata.md); \}

Events that can be published to [`MacroChannelsTopic`].

## Union Members

### Type Literal

\{ `event_type`: `"channel.picture_changed"`; `metadata`: [`ChannelPictureChangedMetadata`](ChannelPictureChangedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"channel.picture_changed"` | - |
| `metadata` | [`ChannelPictureChangedMetadata`](ChannelPictureChangedMetadata.md) | A channel's profile picture changed. |

***

### Type Literal

\{ `event_type`: `"channel.created"`; `metadata`: [`ChannelCreatedMetadata`](ChannelCreatedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"channel.created"` | - |
| `metadata` | [`ChannelCreatedMetadata`](ChannelCreatedMetadata.md) | A channel was created. |

***

### Type Literal

\{ `event_type`: `"channel.updated"`; `metadata`: [`ChannelUpdatedMetadata`](ChannelUpdatedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"channel.updated"` | - |
| `metadata` | [`ChannelUpdatedMetadata`](ChannelUpdatedMetadata.md) | A channel's metadata was updated (rename). |

***

### Type Literal

\{ `event_type`: `"channel.deleted"`; `metadata`: [`ChannelDeletedMetadata`](ChannelDeletedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"channel.deleted"` | - |
| `metadata` | [`ChannelDeletedMetadata`](ChannelDeletedMetadata.md) | A channel was deleted. |

***

### Type Literal

\{ `event_type`: `"channel.participant_added"`; `metadata`: [`ChannelParticipantAddedMetadata`](ChannelParticipantAddedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"channel.participant_added"` | - |
| `metadata` | [`ChannelParticipantAddedMetadata`](ChannelParticipantAddedMetadata.md) | Participants were added to a channel (admin invite or self-join). |

***

### Type Literal

\{ `event_type`: `"channel.participant_removed"`; `metadata`: [`ChannelParticipantRemovedMetadata`](ChannelParticipantRemovedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"channel.participant_removed"` | - |
| `metadata` | [`ChannelParticipantRemovedMetadata`](ChannelParticipantRemovedMetadata.md) | Participants were removed from a channel (admin removal or self-leave). |

***

### Type Literal

\{ `event_type`: `"channel.access_requested"`; `metadata`: [`ChannelAccessRequestedMetadata`](ChannelAccessRequestedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"channel.access_requested"` | - |
| `metadata` | [`ChannelAccessRequestedMetadata`](ChannelAccessRequestedMetadata.md) | Someone outside a channel asked to join it. |
