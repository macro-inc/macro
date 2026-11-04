CREATE INDEX entity_access_request_event_request_history
    ON entity_access_request_event (request_id, created_at, id);
