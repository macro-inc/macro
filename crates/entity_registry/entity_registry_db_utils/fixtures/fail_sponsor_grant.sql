-- Fail the second grant after the bot grant has already succeeded.
CREATE FUNCTION fail_sponsor_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_type = 'user' THEN
        RAISE EXCEPTION 'injected sponsor grant failure';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER fail_sponsor_grant BEFORE INSERT ON entity_access
FOR EACH ROW EXECUTE FUNCTION fail_sponsor_grant();
