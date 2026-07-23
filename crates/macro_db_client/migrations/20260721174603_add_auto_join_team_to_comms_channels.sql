ALTER TABLE public.comms_channels
    ADD COLUMN auto_join_team BOOLEAN NOT NULL DEFAULT FALSE;
