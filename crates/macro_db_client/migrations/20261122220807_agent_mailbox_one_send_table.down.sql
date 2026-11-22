-- Back to a dedupe ledger plus a separate audit table.
SET LOCAL lock_timeout = '5s';

DELETE FROM agent_mailbox_sweep_claims WHERE name = 'prune';
ALTER TABLE agent_mailbox_sweep_claims
    DROP CONSTRAINT agent_mailbox_sweep_claims_name_check,
    ADD CONSTRAINT agent_mailbox_sweep_claims_name_check CHECK (name IN ('orphans'));

CREATE TABLE agent_mailbox_send_audit (
    mailbox_id UUID NOT NULL REFERENCES agent_mailboxes (id),
    idempotency_key UUID NOT NULL,
    team_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('message', 'reply')),
    recipient_count INTEGER NOT NULL CHECK (recipient_count > 0),
    fingerprint BYTEA NOT NULL CHECK (octet_length(fingerprint) = 32),
    outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'sent', 'refused')),
    provider_message_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 1,
    approved_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (mailbox_id, idempotency_key),
    CHECK ((outcome = 'sent') = (provider_message_id IS NOT NULL))
);

CREATE INDEX agent_mailbox_send_audit_approved_idx
    ON agent_mailbox_send_audit (approved_at);

INSERT INTO agent_mailbox_send_audit
    (mailbox_id, idempotency_key, team_id, kind, recipient_count, fingerprint, outcome,
     provider_message_id, attempts, approved_at, updated_at)
SELECT mailbox_id, idempotency_key, team_id, kind, recipient_count, fingerprint, outcome,
       provider_message_id, attempts, reserved_at, updated_at
FROM agent_mailbox_sends;

-- The ledger held only sends that count, for its 7 days.
DELETE FROM agent_mailbox_sends
WHERE outcome = 'refused' OR reserved_at < now() - interval '7 days';

DROP INDEX agent_mailbox_sends_window_idx;
DROP INDEX agent_mailbox_sends_team_window_idx;
DROP INDEX agent_mailbox_sends_reserved_idx;

ALTER TABLE agent_mailbox_sends RENAME COLUMN reserved_at TO created_at;
ALTER TABLE agent_mailbox_sends
    ALTER COLUMN created_at SET DEFAULT now(),
    DROP CONSTRAINT agent_mailbox_sends_outcome_check,
    DROP CONSTRAINT agent_mailbox_sends_attempts_check,
    DROP CONSTRAINT agent_mailbox_sends_sent_check,
    DROP COLUMN outcome,
    DROP COLUMN attempts,
    DROP COLUMN updated_at,
    DROP CONSTRAINT agent_mailbox_sends_mailbox_id_fkey,
    ADD CONSTRAINT agent_mailbox_sends_mailbox_id_fkey
        FOREIGN KEY (mailbox_id) REFERENCES agent_mailboxes (id) ON DELETE CASCADE;

CREATE INDEX agent_mailbox_sends_window_idx
    ON agent_mailbox_sends (mailbox_id, created_at);

CREATE INDEX agent_mailbox_sends_team_window_idx
    ON agent_mailbox_sends (team_id, created_at);

CREATE INDEX agent_mailbox_sends_created_idx
    ON agent_mailbox_sends (created_at);
