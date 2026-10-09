DO $$ BEGIN RAISE EXCEPTION 'Provider facts are shared by deployed readers; retire them with a forward migration'; END $$;
