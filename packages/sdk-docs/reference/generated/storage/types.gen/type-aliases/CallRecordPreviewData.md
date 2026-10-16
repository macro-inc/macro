# Type Alias: CallRecordPreviewData

> **CallRecordPreviewData** = \{ `callId`: `string`; `channelId?`: `string` \| `null`; `channelName?`: `string` \| `null`; `customName?`: `string` \| `null`; `endedAt?`: `string` \| `null`; `startedAt`: `string`; \}

Preview payload returned for each found call id.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-callid"></a> `callId` | `string` | The call identifier. |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | The channel this call belongs to. |
| <a id="property-channelname"></a> `channelName?` | `string` \| `null` | Resolved display name for the channel. |
| <a id="property-customname"></a> `customName?` | `string` \| `null` | User-supplied or AI-generated display name for the call. Only set on archived `call_records`; active calls always return `None`. |
| <a id="property-endedat"></a> `endedAt?` | `string` \| `null` | When the call ended (None if still active). |
| <a id="property-startedat"></a> `startedAt` | `string` | When the call started (created_at for active, started_at for archived). |
