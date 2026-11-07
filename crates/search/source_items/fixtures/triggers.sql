-- Turns on projection maintenance, which the migrations leave off, before a test writes inputs.
SELECT public.source_items_install_triggers();
