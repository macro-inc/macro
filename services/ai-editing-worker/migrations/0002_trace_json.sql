-- Traces are now stored as structured JSON (a serialized TraceSession) rather
-- than pre-rendered markdown; markdown is regenerated from the JSON on demand.
ALTER TABLE edit_traces RENAME COLUMN markdown TO trace_json;
