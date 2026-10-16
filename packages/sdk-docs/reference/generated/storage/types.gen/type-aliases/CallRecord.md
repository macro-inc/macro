# Type Alias: CallRecord

> **CallRecord** = \{ `callId`: `string`; `channelId?`: `string` \| `null`; `channelName?`: `string` \| `null`; `createdBy`: `string`; `customName?`: `string` \| `null`; `durationMs?`: `number` \| `null`; `egressId?`: `string` \| `null`; `endedAt?`: `string` \| `null`; `guests`: [`CallRecordGuest`](CallRecordGuest.md)[]; `isActive`: `boolean`; `participants`: [`CallRecordParticipant`](CallRecordParticipant.md)[]; `recordingPreviewUrl?`: `string` \| `null`; `recordingStartedAt?`: `string` \| `null`; `recordingUrl?`: `string` \| `null`; `roomName`: `string`; `shareWithTeam`: `boolean`; `startedAt`: `string`; `status?`: `null` \| [`CallStatus`](CallStatus.md); `summary?`: `string` \| `null`; `teamShareAccessLevel?`: `null` \| [`AccessLevel`](AccessLevel.md); `transcript`: [`CallRecordTranscriptSegment`](CallRecordTranscriptSegment.md)[]; `userAccessLevel?`: `null` \| [`AccessLevel`](AccessLevel.md); `viewerHasDeclined?`: `boolean`; \}

Full record of a call, unifying rows from `calls` (active) and
`call_records` (archived) into a single response shape.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-callid"></a> `callId` | `string` | The call identifier. |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | The channel this call belongs to. |
| <a id="property-channelname"></a> `channelName?` | `string` \| `null` | Resolved display name for the channel. |
| <a id="property-createdby"></a> `createdBy` | `string` | User who created the call. |
| <a id="property-customname"></a> `customName?` | `string` \| `null` | User-supplied or AI-generated display name for the call. Only set on archived `call_records`; active calls always return `None`. |
| <a id="property-durationms"></a> `durationMs?` | `number` \| `null` | Call duration in milliseconds (None if still active). |
| <a id="property-egressid"></a> `egressId?` | `string` \| `null` | Recording egress ID, if any. |
| <a id="property-endedat"></a> `endedAt?` | `string` \| `null` | When the call ended (None if still active). |
| <a id="property-guests"></a> `guests` | [`CallRecordGuest`](CallRecordGuest.md)[] | Non-account guests (both active and historic). Guests only ever exist on standalone meeting calls, never on channel calls. |
| <a id="property-isactive"></a> `isActive` | `boolean` | Whether the call is currently active (from `calls` table). |
| <a id="property-participants"></a> `participants` | [`CallRecordParticipant`](CallRecordParticipant.md)[] | Macro-account participants (both active and historic). |
| <a id="property-recordingpreviewurl"></a> `recordingPreviewUrl?` | `string` \| `null` | Presigned URL for the call recording preview image, if available. |
| <a id="property-recordingstartedat"></a> `recordingStartedAt?` | `string` \| `null` | When the egress recording actually began. `None` until the `egress_started` webhook arrives (typically a few seconds after `started_at`). Frontend should anchor transcript-to-audio sync to this value when present, falling back to `started_at` otherwise. |
| <a id="property-recordingurl"></a> `recordingUrl?` | `string` \| `null` | Presigned URL for the call recording, if available. |
| <a id="property-roomname"></a> `roomName` | `string` | The RTC room name. |
| <a id="property-sharewithteam"></a> `shareWithTeam` | `boolean` | Whether the call is shared with the creator's team. While the call is live this is the pending toggle applied at archive; afterwards it mirrors `team_share_access_level`. |
| <a id="property-startedat"></a> `startedAt` | `string` | When the call started (created_at for active, started_at for archived). |
| <a id="property-status"></a> `status?` | `null` \| [`CallStatus`](CallStatus.md) | - |
| <a id="property-summary"></a> `summary?` | `string` \| `null` | AI-generated summary of the call. Only set on archived `call_records` once summarization has run; active calls always return `None`. |
| <a id="property-teamshareaccesslevel"></a> `teamShareAccessLevel?` | `null` \| [`AccessLevel`](AccessLevel.md) | - |
| <a id="property-transcript"></a> `transcript` | [`CallRecordTranscriptSegment`](CallRecordTranscriptSegment.md)[] | Transcript segments ordered by `sequence_num`. |
| <a id="property-useraccesslevel"></a> `userAccessLevel?` | `null` \| [`AccessLevel`](AccessLevel.md) | - |
| <a id="property-viewerhasdeclined"></a> `viewerHasDeclined?` | `boolean` | Whether the authenticated viewer has declined this call on any device. Set on the single-record read so clients that missed `call_declined` can still stop ringing via reconciliation; `false` in list contexts. |
