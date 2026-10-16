# Type Alias: EditCallTranscriptRequest

> **EditCallTranscriptRequest** = \{ `assignments`: [`CustomSpeakerAssignment`](CustomSpeakerAssignment.md)[]; \}

Body of `PATCH /call/record/{call_id}/transcript`.

Each entry in `assignments` sets (or clears, when `custom_speaker` is
`None`) the `custom_speaker` override for every transcript row in the
call whose `diarized_speaker_id` matches. Diarized speakers not listed
are left untouched. Empty `assignments` is a 204 no-op.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-assignments"></a> `assignments` | [`CustomSpeakerAssignment`](CustomSpeakerAssignment.md)[] | The set of per-diarized-speaker overrides to apply. |
