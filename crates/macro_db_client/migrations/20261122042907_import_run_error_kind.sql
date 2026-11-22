-- Why a workspace import run failed, as a closed set of kinds the app and the
-- agent show copy for instead of the error text. NULL while the run has not
-- failed, and on runs that failed before this column existed.
--
-- A nullable column without a default is a catalog-only change; the CHECK
-- scans import_run (one row per user and source) under a short lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_run
    ADD COLUMN error_kind TEXT
    CHECK (error_kind IN (
        'not_found', 'forbidden', 'access_lost', 'connection_unavailable',
        'not_connected', 'rate_limited', 'unreachable', 'usage_refused',
        'internal'
    ));
