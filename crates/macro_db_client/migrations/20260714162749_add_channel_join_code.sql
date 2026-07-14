ALTER TABLE public.comms_channels
ADD COLUMN join_code UUID;

CREATE UNIQUE INDEX comms_channels_join_code_uq
ON public.comms_channels (join_code)
WHERE join_code IS NOT NULL;
