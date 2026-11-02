-- Meeting notes linked to calendar events were removed with the feature.
DROP FUNCTION IF EXISTS calendar_note_event_visible(text, uuid, text);
DROP FUNCTION IF EXISTS calendar_note_copies_match(uuid, uuid, text);
DROP FUNCTION IF EXISTS calendar_note_link_key(uuid, text);
DROP TABLE IF EXISTS calendar_event_notes;
