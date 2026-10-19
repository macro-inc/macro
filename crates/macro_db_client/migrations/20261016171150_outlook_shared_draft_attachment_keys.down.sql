-- Reinstating uniqueness can reject retained objects shared by multiple drafts.
DO $$ BEGIN
    RAISE EXCEPTION 'Shared draft attachment keys require a forward migration to retire safely';
END $$;
