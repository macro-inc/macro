# Type Alias: CallStartedMetadata

> **CallStartedMetadata** = \{ `channel_name?`: `string` \| `null`; `sender_profile_picture_url?`: `string` \| `null`; \}

Metadata for a notification that a call has started in a channel.

Mirrors the producer-side `CallStartedNotification` in the `call` crate:
both serialize the same wire shape (snake_case fields) under the same
`call_started` [`Notification::TYPE_NAME`]. This type is the read-side
model used by [`crate::NotifEvent`]; the producer keeps its own type
because it additionally builds the incoming-call APNS/VoIP push.

Rows persisted before the type name was normalized used the kebab-case
`call-started`; the [`crate::NotifEvent::CallStarted`] variant carries a
`#[serde(alias = "call-started")]` so those rows still deserialize.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_name"></a> `channel_name?` | `string` \| `null` | The name of the channel the call started in, when available. |
| <a id="property-sender_profile_picture_url"></a> `sender_profile_picture_url?` | `string` \| `null` | Profile picture URL of the user who started the call, when available. |
