ALTER TABLE entity_access_request
    DROP CONSTRAINT entity_access_request_requested_level_check,
    ADD CONSTRAINT entity_access_request_requested_level_check
        CHECK (requested_level IN ('view', 'comment', 'edit'));
