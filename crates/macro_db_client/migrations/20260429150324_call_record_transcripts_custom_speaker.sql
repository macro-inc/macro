-- Manually-corrected speaker for a transcript row, identified by Macro user id
-- (e.g. `macro|alice@example.com`). When set, it overrides the derived
-- `speaker_id` (which comes from the LiveKit track owner) on read. NULL means
-- "use speaker_id as-is". Set per diarized speaker via
-- PATCH /call/record/{call_id}/transcript.

ALTER TABLE call_record_transcripts
    ADD COLUMN IF NOT EXISTS custom_speaker TEXT;
