-- A source's content is eligible for team sharing only after it has been
-- fetched under the calendar's current provider role. Existing snapshots stay
-- unverified until the new sync worker observes them; old binaries can keep
-- writing sources without granting team access to an unverified snapshot.
ALTER TABLE calendar_event_sources ADD COLUMN provider_access_role text;
