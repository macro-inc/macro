-- Preserve an unpublished creation when its initial projection is enriched.
CREATE OR REPLACE FUNCTION calendar_outlook_projection_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_value calendar_events;
BEGIN
    IF TG_OP='DELETE' THEN row_value:=OLD; ELSE row_value:=NEW; END IF;
    IF row_value.canonical_source_kind='outlook' THEN
        INSERT INTO calendar_projection_outbox(event_id,owner_id,link_id,change_kind)
        VALUES(row_value.id,row_value.owner_id,row_value.source_link_id,lower(CASE WHEN TG_OP='INSERT' THEN 'created' WHEN TG_OP='UPDATE' THEN 'updated' ELSE 'deleted' END))
        ON CONFLICT(event_id) DO UPDATE SET change_kind=CASE WHEN calendar_projection_outbox.change_kind='created' AND EXCLUDED.change_kind='updated' THEN 'created' ELSE EXCLUDED.change_kind END,owner_id=EXCLUDED.owner_id,link_id=EXCLUDED.link_id,revision=calendar_projection_outbox.revision+1,next_run_at=now();
    END IF;
    RETURN NULL;
END $$;
