DO $$ BEGIN
    RAISE EXCEPTION 'Retire folder catalog streams with a forward migration before removing their schema';
END $$;
