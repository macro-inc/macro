SET LOCAL lock_timeout = '1s';

-- Whether a pending publication may change teammates' out-of-office rows. The
-- team overlay reads sources by their typed event_type, and an Outlook event
-- carries its content source's, so only a change to an event that was or is
-- out of office can move those rows. Rows queued before this column existed
-- keep the conservative hint.
ALTER TABLE calendar_projection_outbox ADD COLUMN team_ooo_changed boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION calendar_outlook_projection_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    row_value calendar_events;
    out_of_office boolean;
BEGIN
    IF TG_OP='DELETE' THEN row_value:=OLD; ELSE row_value:=NEW; END IF;
    IF row_value.canonical_source_kind='outlook' THEN
        out_of_office:=CASE TG_OP
            WHEN 'INSERT' THEN NEW.event_type='out_of_office'
            WHEN 'DELETE' THEN OLD.event_type='out_of_office'
            ELSE OLD.event_type='out_of_office' OR NEW.event_type='out_of_office'
        END;
        -- A revision still waiting keeps the hint of every change it carries.
        INSERT INTO calendar_projection_outbox(event_id,owner_id,link_id,change_kind,team_ooo_changed)
        VALUES(row_value.id,row_value.owner_id,row_value.source_link_id,lower(CASE WHEN TG_OP='INSERT' THEN 'created' WHEN TG_OP='UPDATE' THEN 'updated' ELSE 'deleted' END),out_of_office)
        ON CONFLICT(event_id) DO UPDATE SET change_kind=CASE WHEN calendar_projection_outbox.change_kind='created' AND EXCLUDED.change_kind='updated' THEN 'created' ELSE EXCLUDED.change_kind END,owner_id=EXCLUDED.owner_id,link_id=EXCLUDED.link_id,revision=calendar_projection_outbox.revision+1,next_run_at=now(),
            team_ooo_changed=calendar_projection_outbox.team_ooo_changed OR EXCLUDED.team_ooo_changed;
    END IF;
    RETURN NULL;
END $$;
