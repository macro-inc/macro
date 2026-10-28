# Type Alias: SoupCallRecordSoupPropertiesField

> **SoupCallRecordSoupPropertiesField** = \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `attended`: `boolean`; `callId`: `string`; `channelId?`: `string` \| `null`; `channelName?`: `string` \| `null`; `createdBy`: `string`; `customName?`: `string` \| `null`; `durationMs?`: `number` \| `null`; `endedAt?`: `string` \| `null`; `guests`: [`SoupCallRecordGuest`](SoupCallRecordGuest.md)[]; `isActive`: `boolean`; `participants`: [`SoupCallRecordParticipant`](SoupCallRecordParticipant.md)[]; `startedAt`: `string`; `status`: [`CallStatus`](CallStatus.md); `summary?`: `string` \| `null`; \}

A call record as displayed in Soup. Excludes room_name, egress_id,
and transcript — fields that are irrelevant for the soup feed.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `attended` | `boolean` | Whether the requesting user attended this call. Kept for compatibility and derived from `status == ATTENDED`. |
| `callId` | `string` | The call identifier. |
| `channelId?` | `string` \| `null` | The channel this call belongs to. |
| `channelName?` | `string` \| `null` | Resolved display name for the channel. |
| `createdBy` | `string` | User who created the call. |
| `customName?` | `string` \| `null` | User-supplied or AI-generated display name for the call. |
| `durationMs?` | `number` \| `null` | Call duration in milliseconds (None if still active). |
| `endedAt?` | `string` \| `null` | When the call ended (None if still active). |
| `guests` | [`SoupCallRecordGuest`](SoupCallRecordGuest.md)[] | Non-account guests in the call. |
| `isActive` | `boolean` | Whether the call is currently active. |
| `participants` | [`SoupCallRecordParticipant`](SoupCallRecordParticipant.md)[] | Macro-account participants in the call. |
| `startedAt` | `string` | When the call started. |
| `status` | [`CallStatus`](CallStatus.md) | Viewer-relative call status for the requesting user. |
| `summary?` | `string` \| `null` | AI-generated summary of the call. Only set on archived `call_records` once summarization has run; active calls always return `None`. |
