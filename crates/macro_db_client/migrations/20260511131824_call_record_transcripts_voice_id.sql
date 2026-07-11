ALTER TABLE call_record_transcripts
    ADD COLUMN voice_id UUID REFERENCES voice(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_call_record_transcripts_voice_id
    ON call_record_transcripts (voice_id);
