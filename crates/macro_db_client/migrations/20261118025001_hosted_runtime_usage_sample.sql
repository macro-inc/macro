-- One reading per running Macro computer per minute, for the CPU and memory
-- graphs in Settings. The overcommit pass writes them from what each host
-- measures of its guests; readings older than 25 hours are deleted.
--
-- No foreign key to hosted_runtime: purchases, starts and effect leases
-- lock those rows, and a once-a-minute insert must never queue behind them
-- or hold them. Readings of a deleted computer age out with the rest.
CREATE TABLE hosted_runtime_usage_sample (
    computer_id UUID NOT NULL,
    -- sampled_at truncated to the minute: one reading per computer per minute,
    -- whichever control-plane replica writes it first.
    minute TIMESTAMPTZ NOT NULL,
    sampled_at TIMESTAMPTZ NOT NULL,
    -- CPU time the guest's process had used (its cgroup counter, as read):
    -- use between two readings is the counter's growth.
    cpu_usage_microseconds BIGINT NOT NULL CHECK (cpu_usage_microseconds >= 0),
    -- Memory only this guest holds, in RAM or swapped out.
    memory_bytes BIGINT NOT NULL CHECK (memory_bytes >= 0),
    PRIMARY KEY (computer_id, minute)
);

-- Rows arrive in time order, so a block-range index finds the old ones for
-- the retention delete at almost no write cost.
CREATE INDEX hosted_runtime_usage_sample_minute_brin
    ON hosted_runtime_usage_sample USING brin (minute);
