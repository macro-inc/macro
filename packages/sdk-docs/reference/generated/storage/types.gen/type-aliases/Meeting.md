# Type Alias: Meeting

> **Meeting** = \{ `callId?`: `string` \| `null`; `channelId?`: `string` \| `null`; `id`: `string`; `scheduledEnd?`: `string` \| `null`; `scheduledStart?`: `string` \| `null`; `shareToken`: [`MeetingToken`](MeetingToken.md); `title`: `string`; \}

Persistent meeting metadata. No channel contents or archived media are exposed.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-callid"></a> `callId?` | `string` \| `null` | Currently active call session, if any. |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | Associated channel, for links to existing channel calls only. |
| <a id="property-id"></a> `id` | `string` | Persistent meeting identifier. |
| <a id="property-scheduledend"></a> `scheduledEnd?` | `string` \| `null` | Scheduled end, or none for an instant meeting. |
| <a id="property-scheduledstart"></a> `scheduledStart?` | `string` \| `null` | Scheduled start, or none for an instant meeting. |
| <a id="property-sharetoken"></a> `shareToken` | [`MeetingToken`](MeetingToken.md) | Bearer capability embedded in the invitation URL. |
| <a id="property-title"></a> `title` | `string` | Human-readable meeting title. |
