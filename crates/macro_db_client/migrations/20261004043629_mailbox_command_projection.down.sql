DO $$ BEGIN RAISE EXCEPTION 'Drain accepted mailbox commands before a forward retirement migration'; END $$;
