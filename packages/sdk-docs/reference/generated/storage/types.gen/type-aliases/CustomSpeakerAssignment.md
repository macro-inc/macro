# Type Alias: CustomSpeakerAssignment

> **CustomSpeakerAssignment** = \{ `customSpeaker`: `string`; `diarizedSpeakerId`: `string`; \}

One per-diarized-speaker override, used in [`EditCallTranscriptRequest`].

`custom_speaker = None` clears any existing override for this
`diarized_speaker_id`; `Some(macro_user_id)` sets it. The string is
expected to parse as a `MacroUserId` (e.g. `macro|alice@example.com`);
the service layer rejects malformed values with `400 Bad Request`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-customspeaker"></a> `customSpeaker` | `string` | Macro user id to attribute matching rows to, or `None` to clear. |
| <a id="property-diarizedspeakerid"></a> `diarizedSpeakerId` | `string` | The diarization label whose rows this assignment targets. |
