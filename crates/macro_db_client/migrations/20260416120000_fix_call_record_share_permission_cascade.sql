-- Break the circular cascade between call_records and SharePermission.
--
-- call_records.share_permission_id was created with ON DELETE CASCADE, and
-- trg_delete_share_permission_call_record (BEFORE DELETE on call_records)
-- also deletes the referenced SharePermission. Deleting a call_record fired
-- the trigger, which deleted the SharePermission, which cascaded back to the
-- same call_record row already being deleted:
--   "tuple to be deleted was already modified by an operation triggered by
--    the current command"
--
-- SharePermission rows tied to a call/call_record are only ever removed via
-- the BEFORE DELETE trigger on call_records; they are never deleted
-- directly. Drop the reverse cascade and mark the FK DEFERRABLE INITIALLY
-- DEFERRED so that when the trigger deletes the SharePermission, the FK
-- check waits until COMMIT (by which time the call_record is also gone).

ALTER TABLE call_records
  DROP CONSTRAINT call_records_share_permission_id_fkey,
  ADD CONSTRAINT call_records_share_permission_id_fkey
    FOREIGN KEY (share_permission_id) REFERENCES "SharePermission"(id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE calls
  DROP CONSTRAINT calls_share_permission_id_fkey,
  ADD CONSTRAINT calls_share_permission_id_fkey
    FOREIGN KEY (share_permission_id) REFERENCES "SharePermission"(id)
    DEFERRABLE INITIALLY DEFERRED;
