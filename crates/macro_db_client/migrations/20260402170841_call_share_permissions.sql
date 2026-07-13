-- Add the share permission to all ephemeral calls
ALTER TABLE calls ADD COLUMN share_permission_id TEXT NOT NULL REFERENCES "SharePermission"(id) ON DELETE CASCADE;

-- Add the share permission to all calls records
ALTER TABLE call_records ADD COLUMN share_permission_id TEXT NOT NULL REFERENCES "SharePermission"(id) ON DELETE CASCADE;

-- Automatically delete the share permission of the call_record when a call record is deleted
-- We only want this for call_records as they are the permanent record of a call not the ephemeral one for active calls
CREATE FUNCTION delete_share_permission_on_call_record_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM "SharePermission" WHERE id = OLD.share_permission_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_delete_share_permission_call_record
BEFORE DELETE ON call_records
FOR EACH ROW
EXECUTE FUNCTION delete_share_permission_on_call_record_delete();
