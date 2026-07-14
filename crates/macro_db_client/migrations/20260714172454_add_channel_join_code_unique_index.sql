-- no-transaction

CREATE UNIQUE INDEX CONCURRENTLY comms_channels_join_code_uq
ON public.comms_channels (join_code)
WHERE join_code IS NOT NULL;
