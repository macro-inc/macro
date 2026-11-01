# Type Alias: CallTokenResponse

> **CallTokenResponse** = \{ `callId`: `string`; `channelId?`: `string` \| `null`; `participantId`: `string`; `roomName`: `string`; `serverUrl`: `string`; `shareToken?`: `string` \| `null`; `token`: `string`; \}

Response returned when creating or joining a call.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-callid"></a> `callId` | `string` | The call identifier. |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | The channel this call is associated with. |
| <a id="property-participantid"></a> `participantId` | `string` | RTC participant identity. |
| <a id="property-roomname"></a> `roomName` | `string` | The RTC room name. |
| <a id="property-serverurl"></a> `serverUrl` | `string` | The RTC server URL for the frontend SDK to connect to. |
| <a id="property-sharetoken"></a> `shareToken?` | `string` \| `null` | Meeting link capability, when joined using a link. |
| <a id="property-token"></a> `token` | `string` | The RTC token for connecting to the room. |
