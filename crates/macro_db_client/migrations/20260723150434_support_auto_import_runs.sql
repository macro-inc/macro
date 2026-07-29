-- A gather run can optionally continue straight through importing every
-- onboarding-staged candidate it discovered. The run status then exposes the
-- import batch's progress and terminal outcome to clients.

CREATE TYPE import_run_status AS ENUM (
    'running',
    'ready',
    'importing',
    'completed',
    'failed',
    'dismissed'
);

ALTER TABLE import_run
    ADD COLUMN auto_import BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE import_run
    DROP CONSTRAINT import_run_status_check;

ALTER TABLE import_run
    ALTER COLUMN status TYPE import_run_status
    USING status::import_run_status;
