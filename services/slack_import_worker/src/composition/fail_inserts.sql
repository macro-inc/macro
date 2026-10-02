-- Installed only in each SQLx test's isolated database. Test-selected AFTER
-- triggers prove that even inserts which succeeded inside an owning helper roll back.
CREATE FUNCTION fail_import_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'injected failure after % insertion', TG_TABLE_NAME;
END;
$$;
