ALTER TABLE agent_session_log
    ADD COLUMN traceparent TEXT,
    ADD COLUMN tracestate TEXT,
    ADD CONSTRAINT agent_session_log_tracestate_requires_traceparent
        CHECK (tracestate IS NULL OR traceparent IS NOT NULL);
