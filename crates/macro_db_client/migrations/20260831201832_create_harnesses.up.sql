-- User-run agent harnesses (macrod daemons) and their credentials.
--
-- A harness is the machine-side runtime an agent's sessions execute on. It is
-- owned by exactly one user (private) or one team (shared with every member),
-- mirroring the bots owner-XOR pattern. Rows are soft-deleted so revoked
-- harnesses stay auditable.
CREATE TABLE public.harnesses (
    id uuid PRIMARY KEY,
    kind text NOT NULL DEFAULT 'macrod' CHECK (kind IN ('macrod')),
    name text NOT NULL CHECK (name <> ''),
    owner_user_id text,
    team_id uuid REFERENCES public.team(id) ON DELETE CASCADE,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    -- Presence bookkeeping written by the runtime gateway on socket
    -- attach/detach. Connected means last_connected_at is the newer of the two.
    last_connected_at timestamptz,
    last_disconnected_at timestamptz,
    CONSTRAINT harnesses_owner_check CHECK (
        (owner_user_id IS NOT NULL)::int + (team_id IS NOT NULL)::int = 1
    )
);

CREATE INDEX harnesses_owner_user_id_idx
    ON public.harnesses (owner_user_id)
    WHERE deleted_at IS NULL;

CREATE INDEX harnesses_team_id_idx
    ON public.harnesses (team_id)
    WHERE deleted_at IS NULL;

-- Bearer credentials a harness daemon authenticates with. Only the SHA-256 of
-- the raw token is stored; the raw secret is shown once at pairing claim.
CREATE TABLE public.harness_tokens (
    id uuid PRIMARY KEY,
    harness_id uuid NOT NULL REFERENCES public.harnesses(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL,
    token_prefix text NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX harness_tokens_harness_id_idx ON public.harness_tokens (harness_id);
CREATE UNIQUE INDEX harness_tokens_token_hash_uq ON public.harness_tokens (token_hash);

-- Device-code pairing requests. A daemon creates one unauthenticated, the user
-- approves it in the web app (creating the harness row), and the daemon claims
-- the credential with the device secret it kept. The raw harness token is
-- minted at claim time, never stored.
CREATE TABLE public.harness_pairing_requests (
    id uuid PRIMARY KEY,
    code text NOT NULL UNIQUE,
    device_secret_hash bytea NOT NULL,
    requested_name text NOT NULL CHECK (requested_name <> ''),
    host_info text,
    -- The scope the daemon's config asked for. Advisory: the approving user
    -- still confirms it in the dialog, which arrives preselected to this.
    -- Null for daemons that predate the field.
    requested_scope text CHECK (requested_scope IN ('private', 'team')),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'claimed')),
    -- Cascade: pairing rows are ephemeral bookkeeping, and an approved row is
    -- deliberately never garbage-collected — without the cascade it would
    -- block the team-delete path that hard-deletes team harnesses.
    harness_id uuid REFERENCES public.harnesses(id) ON DELETE CASCADE,
    approved_by text,
    expires_at timestamptz NOT NULL,
    claimed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX harness_pairing_requests_expires_at_idx
    ON public.harness_pairing_requests (expires_at);

-- Bind agents to registered harnesses.
--
-- `agent_configs.harness` stays the runtime slug ('in-memory', 'cursor', ...).
-- An agent served by a user-run macrod daemon stores the sentinel slug
-- 'macrod' plus the registered harness row it runs on. The check keeps a
-- harness_id from ever riding along with a managed runtime slug; the reverse
-- is allowed — a macrod agent with a null harness_id is unbound, which is
-- what SET NULL leaves behind when its harness is hard-deleted (a member's
-- personal agent must survive its team's deletion; it can be rebound later).
ALTER TABLE agent_configs
    ADD COLUMN harness_id uuid REFERENCES public.harnesses(id) ON DELETE SET NULL,
    ADD CONSTRAINT agent_configs_harness_id_slug_check
        CHECK (harness_id IS NULL OR harness = 'macrod');

-- Sessions do not copy the binding: routing resolves the agent's current
-- harness_id at bind time, so rebinding an agent re-routes existing sessions.
CREATE INDEX agent_configs_harness_id_idx ON agent_configs (harness_id);
