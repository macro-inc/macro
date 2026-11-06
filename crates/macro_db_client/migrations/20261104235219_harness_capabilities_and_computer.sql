-- What a harness's machine can do, reported by macrod after it connects,
-- e.g. {"screen": true} when the box runs a display Macro can stream.
ALTER TABLE public.harnesses
    ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- The Macro computer (hosted VM) this harness runs on; null for a
    -- machine the user paired themselves. No foreign key: computers live in
    -- the hosted runtime tables and outlive soft-deleted harness rows.
    ADD COLUMN computer_id uuid;

-- One live harness per computer.
CREATE UNIQUE INDEX harnesses_computer_id_uq
    ON public.harnesses (computer_id)
    WHERE computer_id IS NOT NULL AND deleted_at IS NULL;
