-- Turns on source_items maintenance, which the migrations leave off. List it before the fixtures
-- whose writes the projection must follow.
SELECT public.source_items_install_triggers();
