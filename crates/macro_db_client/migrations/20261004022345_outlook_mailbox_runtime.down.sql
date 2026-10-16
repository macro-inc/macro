-- Removing a provider enum or durable command/checkpoint records is destructive.
-- Roll application code back independently; remove schema in a later migration
-- only after the provider is disabled and its retained data is handled explicitly.
DO $$ BEGIN
    RAISE EXCEPTION 'Outlook runtime schema requires a forward migration to retire safely';
END $$;
