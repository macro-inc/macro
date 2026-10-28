-- A session's changes can be a pull request changeset shared with every other
-- reader of the same base and head, instead of a patch stored under the
-- session. At most one of the two says where the session's patch is.
ALTER TABLE agent_session_changes
    ADD COLUMN pull_request_changeset_id UUID
        REFERENCES github_pull_request_changeset(id) ON DELETE SET NULL,
    ADD CONSTRAINT agent_session_changes_one_patch_location CHECK (
        patch_blob_key IS NULL OR pull_request_changeset_id IS NULL
    );
