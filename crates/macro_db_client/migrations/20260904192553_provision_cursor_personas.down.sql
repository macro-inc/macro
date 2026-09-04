DO $$
BEGIN
    RAISE EXCEPTION 'provision_cursor_personas is irreversible because its identity markers preserve user personas';
END;
$$;
