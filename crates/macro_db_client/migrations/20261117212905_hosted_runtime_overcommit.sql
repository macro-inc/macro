-- How far each Macro computer host may be overcommitted, what it last
-- reported about its memory, and which computers relief hibernated. Every
-- setting is per host, so changing one is an UPDATE, not a deploy.
--
-- Defaults were measured on an n2-standard-32 (32 vCPUs, 128 GiB) restoring
-- 4 vCPU / 8 GiB computers from one golden snapshot: 6:1 vCPUs (with the host
-- agent weighting active computers' CPU), 4:1 memory, 2 vCPUs and 16 GiB kept
-- for the host, two computers sold per awake one,
-- and live memory gating at 70 / 80 / 90 % of host memory.

-- Purchases, starts and effect leases lock these rows; never queue behind them.
SET LOCAL lock_timeout = '3s';

ALTER TABLE hosted_runtime_host
    -- Awake vCPUs per vCPU left after the reserve, in percent.
    ADD COLUMN cpu_allocation_percent INTEGER NOT NULL DEFAULT 600 CHECK (cpu_allocation_percent > 0),
    -- Awake memory per GiB of host memory left after the reserve, in percent.
    ADD COLUMN ram_allocation_percent INTEGER NOT NULL DEFAULT 400 CHECK (ram_allocation_percent > 0),
    ADD COLUMN reserved_vcpus INTEGER NOT NULL DEFAULT 2 CHECK (reserved_vcpus >= 0),
    ADD COLUMN reserved_memory_gib INTEGER NOT NULL DEFAULT 16 CHECK (reserved_memory_gib >= 0),
    -- Sold computers per awake one.
    ADD COLUMN oversell_factor INTEGER NOT NULL DEFAULT 2 CHECK (oversell_factor >= 1),
    -- Shares of the host's memory, in percent: relief stops under the low
    -- watermark, the host stops admitting at the high one, and no start may
    -- take it over the hard ceiling, which the host agent also enforces on
    -- its guests.
    ADD COLUMN memory_low_watermark_percent INTEGER NOT NULL DEFAULT 70,
    ADD COLUMN memory_high_watermark_percent INTEGER NOT NULL DEFAULT 80,
    ADD COLUMN memory_hard_ceiling_percent INTEGER NOT NULL DEFAULT 90,
    ADD CONSTRAINT hosted_runtime_host_memory_watermarks CHECK (
        memory_low_watermark_percent >= 0
        AND memory_low_watermark_percent < memory_high_watermark_percent
        AND memory_high_watermark_percent <= memory_hard_ceiling_percent
        AND memory_hard_ceiling_percent <= 100
    ),
    -- Resident memory a computer is expected to add when it starts.
    ADD COLUMN start_resident_memory_mib BIGINT NOT NULL DEFAULT 1536 CHECK (start_resident_memory_mib >= 0),
    -- How long a guest must be idle before relief may hibernate it.
    ADD COLUMN minimum_idle_seconds INTEGER NOT NULL DEFAULT 900 CHECK (minimum_idle_seconds > 0),
    -- How old the host's memory report may be and still admit starts.
    ADD COLUMN memory_report_freshness_seconds INTEGER NOT NULL DEFAULT 30 CHECK (memory_report_freshness_seconds > 0),
    -- Starts and wakes admitted since the last memory report; each counts as
    -- start_resident_memory_mib until the next report measures it.
    ADD COLUMN admitted_since_report INTEGER NOT NULL DEFAULT 0 CHECK (admitted_since_report >= 0),
    -- When the last of them was admitted: a report measured before it
    -- leaves the count in place.
    ADD COLUMN last_admitted_at TIMESTAMPTZ,
    -- What the host last reported: hardware at registration, memory every
    -- few seconds. Null until it first does; nothing is admitted until then.
    ADD COLUMN total_vcpus INTEGER CHECK (total_vcpus >= 0),
    ADD COLUMN total_memory_mib BIGINT CHECK (total_memory_mib >= 0),
    ADD COLUMN resident_memory_mib BIGINT CHECK (resident_memory_mib >= 0),
    ADD COLUMN memory_reported_at TIMESTAMPTZ;

ALTER TABLE hosted_runtime
    -- When relief hibernated the awake computer: it holds no host memory and
    -- counts against neither allocation nor live memory until it wakes.
    -- Null while it holds memory.
    ADD COLUMN hibernated_at TIMESTAMPTZ,
    -- When a wake of the hibernated computer was first asked for (its team
    -- powered it on, or the harness has a prompt for its macrod); null once
    -- it woke. The overcommit pass retries it until the host has room.
    ADD COLUMN wake_requested_at TIMESTAMPTZ;
