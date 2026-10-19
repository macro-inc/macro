-- Popup and email reminders may now coexist. Do not delete reminder records or
-- rebuild the old keys under a blocking lock to make a downgrade succeed.
DO $$ BEGIN
    RAISE EXCEPTION 'Reminder method keys require a forward migration to retire safely';
END $$;
