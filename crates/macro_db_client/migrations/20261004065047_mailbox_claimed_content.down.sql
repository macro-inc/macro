DO $$ BEGIN RAISE EXCEPTION 'Forward-only migration: remove claimed-content readers before retiring the column'; END $$;
