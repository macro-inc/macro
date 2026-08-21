ALTER TABLE agent_session_log
    DROP CONSTRAINT agent_session_log_tracestate_requires_traceparent,
    DROP COLUMN tracestate,
    DROP COLUMN traceparent;
