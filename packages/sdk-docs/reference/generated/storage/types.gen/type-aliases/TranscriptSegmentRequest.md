# Type Alias: TranscriptSegmentRequest

> **TranscriptSegmentRequest** = \{ `content`: `string`; `diarizedSpeakerId?`: `string` \| `null`; `embedding?`: `number`[] \| `null`; `endedAt?`: `string` \| `null`; `isFinal`: `boolean`; `segmentId`: `string`; `speakerId`: `string`; `startedAt`: `string`; `streamStartedAt?`: `string` \| `null`; \}

A transcript segment from LiveKit Inference STT.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content` | `string` | The transcribed text content. |
| <a id="property-diarizedspeakerid"></a> `diarizedSpeakerId?` | `string` \| `null` | Stable per-speaker identifier produced by the STT provider's diarization pass. Namespaced upstream by audio track so values are unique across all tracks in a call. `None` when the provider didn't return a speaker label. |
| <a id="property-embedding"></a> `embedding?` | `number`[] \| `null` | Speaker voice embedding computed by the transcription agent (e.g. a Resemblyzer 256-dim vector). When present, the server upserts a `voice` row and stores the resulting id on the transcript segment so the call-finished pipeline can match it to enrolled users. |
| <a id="property-endedat"></a> `endedAt?` | `string` \| `null` | When the speaker stopped talking for this segment. |
| <a id="property-isfinal"></a> `isFinal` | `boolean` | Whether this is a final transcription (not interim). |
| <a id="property-segmentid"></a> `segmentId` | `string` | LiveKit segment ID (used for deduplication across multiple submitters). |
| <a id="property-speakerid"></a> `speakerId` | `string` | The speaker's user ID (from `lk.transcribed_track_id`). |
| <a id="property-startedat"></a> `startedAt` | `string` | When the speaker started talking for this segment. |
| <a id="property-streamstartedat"></a> `streamStartedAt?` | `string` \| `null` | Wall-clock when the transcriber's STT stream first received audio for this participant. The server takes the earliest non-null value across all participants and uses it to overwrite the `egress_started`-derived `recording_started_at`, which is too early (it stamps egress bootstrap, not first audio frame). |
