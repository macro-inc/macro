-- Makes sure source_items maintenance is on (the enabling migration already turns it on, so this
-- keeps the fixture independent of migration state) and records the empty table as backfilled. List it before the fixtures whose writes the projection must follow.
SELECT public.source_items_install_triggers();
UPDATE public.source_items_control SET backfilled_at = now();
