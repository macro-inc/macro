-- Turns on source_items maintenance, which the migrations leave off, and records the empty
-- table as backfilled. List it before the fixtures whose writes the projection must follow.
SELECT public.source_items_install_triggers();
UPDATE public.source_items_control SET backfilled_at = now();
