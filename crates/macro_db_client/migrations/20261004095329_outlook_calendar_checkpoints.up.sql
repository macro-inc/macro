ALTER TABLE calendar_outlook_work
    ADD COLUMN scan_id uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN full_scan boolean NOT NULL DEFAULT true,
    ADD COLUMN page_loaded boolean NOT NULL DEFAULT false,
    ADD COLUMN page_cursor text,
    ADD COLUMN next_page text,
    ADD COLUMN terminal_cursor text,
    ADD COLUMN pending_ids text[] NOT NULL DEFAULT '{}',
    ADD COLUMN visited_pages text[] NOT NULL DEFAULT '{}';
CREATE TABLE calendar_outlook_members (
    work_id uuid NOT NULL REFERENCES calendar_outlook_work(id) ON DELETE CASCADE,
    provider_id text NOT NULL,
    master_id text NOT NULL,
    scan_id uuid NOT NULL,
    PRIMARY KEY(work_id,provider_id)
);
CREATE INDEX calendar_outlook_members_master ON calendar_outlook_members(work_id,master_id);
