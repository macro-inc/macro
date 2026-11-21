CREATE OR REPLACE FUNCTION external_chat_can_view(chat_id uuid, viewer text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT external_chat_access_level(chat_id, external_chat_sources(viewer)) IS NOT NULL
$$;

DROP FUNCTION external_chat_access_level(uuid, text, uuid);
DROP FUNCTION entity_access_viewer_sources(text, uuid);
DROP FUNCTION entity_access_source_matches(text, text, uuid);
