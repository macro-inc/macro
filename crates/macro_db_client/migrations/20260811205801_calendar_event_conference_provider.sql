-- Records which conferencing system backs an event's conference_url so the
-- product only offers to attach or detach conferences Macro owns. A
-- third-party conference (Zoom and friends, arriving as addOn conference
-- data) stays joinable but is never rewritten by a Macro edit.
--
-- Existing rows are backfilled to 'other': the ingestion that wrote them did
-- not record a solution type, so nothing may claim they are Google Meet.
-- The next sync of each event reclassifies it from the provider payload.
ALTER TABLE calendar_events
    ADD COLUMN conference_provider text
        CHECK (conference_provider IN ('google_meet', 'other'));

UPDATE calendar_events
SET conference_provider = 'other'
WHERE conference_url IS NOT NULL;
