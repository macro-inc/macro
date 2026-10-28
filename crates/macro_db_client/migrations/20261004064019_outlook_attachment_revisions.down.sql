DO $$ BEGIN RAISE EXCEPTION 'Forward-only migration: retire attachment references after all readers are deployed'; END $$;
