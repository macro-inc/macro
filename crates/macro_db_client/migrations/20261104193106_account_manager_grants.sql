-- An agent account's manager access to another account: the request made in a
-- DM, its approval, and the credential it produces. The credential is stored
-- only as a SHA-256 hash, set when the manager claims it.
CREATE TABLE account_manager_grants (
    id uuid PRIMARY KEY,
    managed_user_id text NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    manager_user_id text NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
    requested_by text NOT NULL CHECK (requested_by IN ('managed', 'manager')),
    status text NOT NULL CHECK (
        status IN ('pending', 'approved', 'declined', 'active', 'revoked', 'expired')
    ),
    -- When the pending request or the unclaimed approval stops being usable.
    expires_at timestamptz,
    key_hash bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz,
    last_used_at timestamptz,
    CHECK (managed_user_id <> manager_user_id),
    CHECK ((status = 'active') = (key_hash IS NOT NULL)),
    CHECK ((status IN ('pending', 'approved')) = (expires_at IS NOT NULL))
);

CREATE UNIQUE INDEX account_manager_grants_one_pending_per_pair
    ON account_manager_grants (managed_user_id, manager_user_id)
    WHERE status = 'pending';

CREATE UNIQUE INDEX account_manager_grants_one_active_per_pair
    ON account_manager_grants (managed_user_id, manager_user_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX account_manager_grants_key_hash
    ON account_manager_grants (key_hash)
    WHERE key_hash IS NOT NULL;

-- The partial pair indexes can't serve an account's list of its managers.
CREATE INDEX account_manager_grants_managed_user_id
    ON account_manager_grants (managed_user_id);

-- Backs the cascade from the manager's "User" row.
CREATE INDEX account_manager_grants_manager_user_id
    ON account_manager_grants (manager_user_id);
