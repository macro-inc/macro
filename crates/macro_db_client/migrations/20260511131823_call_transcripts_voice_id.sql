ALTER TABLE call_transcripts
    ADD COLUMN voice_id UUID REFERENCES voice(id) ON DELETE SET NULL;
