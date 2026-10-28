DO $$ BEGIN
    RAISE EXCEPTION 'Outlook mailbox bindings require a forward retirement migration';
END $$;
