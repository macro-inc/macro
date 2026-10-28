CREATE FUNCTION fail_thread_archive_update() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'archive-state test failure';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fail_thread_archive_update
BEFORE UPDATE OF inbox_visible ON email_threads
FOR EACH ROW EXECUTE FUNCTION fail_thread_archive_update();
