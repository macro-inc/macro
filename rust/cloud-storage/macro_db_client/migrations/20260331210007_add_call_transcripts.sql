-- Ephemeral transcript segments for active calls (copied to call_record_transcripts on archive)
CREATE TABLE call_transcripts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id      UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    speaker_id   TEXT NOT NULL,
    content      TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    ended_at     TIMESTAMPTZ,
    sequence_num INT NOT NULL
);

CREATE INDEX idx_call_transcripts_call_id ON call_transcripts(call_id);
