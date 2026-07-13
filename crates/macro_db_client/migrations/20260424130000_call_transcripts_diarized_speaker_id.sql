-- Per-speaker identifier emitted by the STT provider's diarization pass.
-- Unique within a single audio track session; namespaced by track/participant
-- upstream so values are globally unique across a call. Nullable because older
-- segments and non-diarized providers won't populate it.

ALTER TABLE call_transcripts
    ADD COLUMN IF NOT EXISTS diarized_speaker_id TEXT;

ALTER TABLE call_record_transcripts
    ADD COLUMN IF NOT EXISTS diarized_speaker_id TEXT;
