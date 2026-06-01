CREATE TABLE public.bots (
    id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('owned', 'system')),
    owner_user_id text,
    team_id uuid REFERENCES public.team(id) ON DELETE CASCADE,
    name text NOT NULL,
    handle text NOT NULL,
    description text,
    avatar_url text,
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT bots_kind_owner_check CHECK (
        (
            kind = 'owned'
            AND ((owner_user_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1)
        )
        OR (
            kind = 'system'
            AND owner_user_id IS NULL
            AND team_id IS NULL
        )
    )
);

CREATE INDEX bots_owner_user_id_idx
    ON public.bots (owner_user_id)
    WHERE deleted_at IS NULL;

CREATE INDEX bots_team_id_idx
    ON public.bots (team_id)
    WHERE deleted_at IS NULL;

CREATE TABLE public.bot_tokens (
    id uuid PRIMARY KEY,
    bot_id uuid NOT NULL REFERENCES public.bots(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL,
    token_prefix text NOT NULL,
    label text,
    last_used_at timestamptz,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bot_tokens_bot_id_idx
    ON public.bot_tokens (bot_id);

CREATE INDEX bot_tokens_token_prefix_idx
    ON public.bot_tokens (token_prefix);
