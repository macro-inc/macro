-- Add segment_id to call_record_transcripts for deduplication tracking
ALTER TABLE call_record_transcripts ADD COLUMN segment_id TEXT;
