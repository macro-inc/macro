-- Reverse of create_harnesses: unbind agents first, then drop the harness
-- tables in dependency order (pairing requests and tokens reference
-- harnesses). Destroys registered harnesses, their credentials, and any open
-- pairings; agents bound to a harness lose the binding, and the slug check is
-- lifted with the column.
ALTER TABLE agent_configs
    DROP CONSTRAINT agent_configs_harness_id_slug_check,
    DROP COLUMN harness_id;

DROP TABLE public.harness_pairing_requests;
DROP TABLE public.harness_tokens;
DROP TABLE public.harnesses;
