-- An email mailbox of its own for an agent account, hosted by a provider.
-- The row deliberately has no foreign key to "User": it must outlive its
-- account so the provider mailbox can still be released and deleted.
CREATE TABLE agent_mailboxes (
    id UUID PRIMARY KEY,
    -- The caller's retry-stable id: one request makes at most one mailbox.
    request_id UUID NOT NULL UNIQUE,
    -- The agent's own Macro account; only it reads and sends.
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('dead_simple')),
    requested_local_part TEXT,
    display_name TEXT,
    provider_mailbox_id TEXT,
    address TEXT,
    -- The mailbox-scoped provider credential, stored only as KMS ciphertext
    -- bound to this mailbox and user.
    grant_id TEXT,
    grant_key_ciphertext BYTEA,
    grant_kms_key_id TEXT,
    grant_encryption_version SMALLINT,
    state TEXT NOT NULL CHECK (
        state IN ('provisioning', 'active', 'failed', 'paused', 'releasing', 'released')
    ),
    last_error TEXT CHECK (
        last_error IN ('not_configured', 'address_taken', 'quota_exceeded', 'rejected', 'unavailable')
    ),
    paused_at TIMESTAMPTZ,
    -- One provider-side operation (provisioning or teardown) at a time: the
    -- holder's token fences every write it makes, and an expired lease can
    -- be taken over.
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    -- When the sweep may try this mailbox again after a failed step.
    next_sweep_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((provider_mailbox_id IS NULL) = (address IS NULL)),
    CHECK (
        (grant_id IS NULL) = (grant_key_ciphertext IS NULL)
        AND (grant_id IS NULL) = (grant_kms_key_id IS NULL)
        AND (grant_id IS NULL) = (grant_encryption_version IS NULL)
    ),
    CHECK (state <> 'active' OR grant_id IS NOT NULL),
    CHECK ((state = 'paused') = (paused_at IS NOT NULL)),
    CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

-- One live mailbox per agent; also the lookup for every agent request.
CREATE UNIQUE INDEX agent_mailboxes_live_user_idx
    ON agent_mailboxes (user_id)
    WHERE state <> 'released';

-- One live row per provider mailbox; a released row keeps its id for the
-- record without blocking a provider that reuses ids.
CREATE UNIQUE INDEX agent_mailboxes_provider_mailbox_idx
    ON agent_mailboxes (provider, provider_mailbox_id)
    WHERE provider_mailbox_id IS NOT NULL AND state <> 'released';

-- The sweep's work: stalled provisioning, releases, and paused mailboxes.
-- Ordered by updated_at so the sweep's ORDER BY ... LIMIT reads it in order
-- and stops early.
CREATE INDEX agent_mailboxes_sweep_idx
    ON agent_mailboxes (updated_at)
    WHERE state IN ('provisioning', 'releasing', 'paused');

-- Sends from an agent mailbox: idempotency and the per-mailbox caps. A row
-- without a provider message id is in flight (outcome unknown) and counts.
CREATE TABLE agent_mailbox_sends (
    mailbox_id UUID NOT NULL REFERENCES agent_mailboxes (id) ON DELETE CASCADE,
    idempotency_key UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('message', 'reply')),
    provider_message_id TEXT,
    provider_thread_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (mailbox_id, idempotency_key)
);

CREATE INDEX agent_mailbox_sends_window_idx
    ON agent_mailbox_sends (mailbox_id, created_at);

-- Pruning records past their retention.
CREATE INDEX agent_mailbox_sends_created_idx
    ON agent_mailbox_sends (created_at);
