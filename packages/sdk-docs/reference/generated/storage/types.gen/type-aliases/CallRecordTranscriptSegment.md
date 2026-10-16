# Type Alias: CallRecordTranscriptSegment

> **CallRecordTranscriptSegment** = \{ `content`: `string`; `diarizedSpeakerId?`: `string` \| `null`; `endedAt?`: `string` \| `null`; `segmentId?`: `string` \| `null`; `sequenceNum`: `number`; `speakerId`: `string`; `startedAt`: `string`; `transcriptId`: `string`; \}

A transcript segment as returned in a [`CallRecord`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | `string` | The transcribed text content. |
| <a id="property-diarizedspeakerid"></a> `diarizedSpeakerId?` | `string` \| `null` | Stable per-speaker identifier produced by the STT provider's diarization pass. Unique across tracks in the call. `None` when the provider didn't return a speaker label. |
| <a id="property-endedat"></a> `endedAt?` | `string` \| `null` | When the speaker stopped (if known). |
| <a id="property-segmentid"></a> `segmentId?` | `string` \| `null` | LiveKit segment ID (nullable for archived records). |
| <a id="property-sequencenum"></a> `sequenceNum` | `number` | Ordering within the call. |
| <a id="property-speakerid"></a> `speakerId` | `string` | The speaker's user ID. |
| <a id="property-startedat"></a> `startedAt` | `string` | When the speaker started this segment. |
| <a id="property-transcriptid"></a> `transcriptId` | `string` | Stable DB-row id for the segment. |
