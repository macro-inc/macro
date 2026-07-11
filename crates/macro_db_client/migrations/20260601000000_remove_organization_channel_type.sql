UPDATE public.comms_channels
SET channel_type = 'private'::public.comms_channel_type,
    org_id = NULL
WHERE channel_type = 'organization'::public.comms_channel_type;

UPDATE public.notification
SET metadata = jsonb_set(metadata, '{channelType}', to_jsonb('private'::text), false)
WHERE metadata->>'channelType' IN ('organization', 'Organization');

UPDATE public.notification
SET metadata = jsonb_set(metadata, '{channel_type}', to_jsonb('private'::text), false)
WHERE metadata->>'channel_type' IN ('organization', 'Organization');

DROP INDEX IF EXISTS public.idx_comms_channels_org_id;

ALTER TABLE public.comms_channels
    DROP CONSTRAINT IF EXISTS valid_channel_name,
    DROP CONSTRAINT IF EXISTS valid_org_channel,
    DROP CONSTRAINT IF EXISTS valid_team_channel;

ALTER TYPE public.comms_channel_type RENAME TO comms_channel_type_old;

CREATE TYPE public.comms_channel_type AS ENUM ('public', 'private', 'direct_message', 'team');

ALTER TABLE public.comms_channels
    ALTER COLUMN channel_type TYPE public.comms_channel_type
    USING channel_type::text::public.comms_channel_type;

DROP TYPE public.comms_channel_type_old;

ALTER TABLE public.comms_channels
    ADD CONSTRAINT valid_channel_name CHECK (
        (channel_type = 'direct_message'::public.comms_channel_type AND name IS NULL)
        OR (channel_type = ANY (ARRAY [
            'public'::public.comms_channel_type,
            'team'::public.comms_channel_type
        ]) AND name IS NOT NULL)
        OR (channel_type = 'private'::public.comms_channel_type)
    ),
    ADD CONSTRAINT valid_team_channel CHECK (
        (channel_type = 'team'::public.comms_channel_type AND team_id IS NOT NULL)
        OR (channel_type <> 'team'::public.comms_channel_type AND team_id IS NULL)
    ),
    ADD CONSTRAINT no_channel_org_id CHECK (org_id IS NULL);
