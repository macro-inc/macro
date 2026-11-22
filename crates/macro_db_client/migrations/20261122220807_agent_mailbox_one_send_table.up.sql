-- One record per agent mailbox send: agent_mailbox_sends takes over the
-- outcome, attempts and 400-day retention of agent_mailbox_send_audit, which
-- goes. A refused send is now kept (outcome 'refused') instead of deleted,
-- and the caps skip it. created_at and approved_at become reserved_at, the
-- time the send took its cap slot (the approval is the agent's quote, not a
-- recorded event).
--
-- Both tables are new in the same release as their first migration, are
-- read only by agent mailboxes, and hold at most a few rows per mailbox, so
-- the plain ALTERs and index builds below take their locks for moments.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agent_mailbox_sends
    ADD COLUMN outcome TEXT,
    ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN reserved_at TIMESTAMPTZ,
    ADD COLUMN updated_at TIMESTAMPTZ;

-- The ledger rows still present take their outcome from the audit.
UPDATE agent_mailbox_sends AS sends
SET outcome = audit.outcome,
    attempts = audit.attempts,
    reserved_at = sends.created_at,
    updated_at = audit.updated_at
FROM agent_mailbox_send_audit AS audit
WHERE audit.mailbox_id = sends.mailbox_id
  AND audit.idempotency_key = sends.idempotency_key;

-- A ledger row without an audit row (none are expected): sent or in flight.
UPDATE agent_mailbox_sends
SET outcome = CASE WHEN provider_message_id IS NULL THEN 'pending' ELSE 'sent' END,
    reserved_at = created_at,
    updated_at = created_at
WHERE outcome IS NULL;

-- Sends whose ledger row was refused away or pruned live on from the audit.
INSERT INTO agent_mailbox_sends
    (mailbox_id, idempotency_key, team_id, kind, recipient_count, fingerprint,
     provider_message_id, created_at, outcome, attempts, reserved_at, updated_at)
SELECT audit.mailbox_id, audit.idempotency_key, audit.team_id, audit.kind,
       audit.recipient_count, audit.fingerprint, audit.provider_message_id,
       audit.approved_at, audit.outcome, audit.attempts, audit.approved_at, audit.updated_at
FROM agent_mailbox_send_audit AS audit
WHERE NOT EXISTS (
    SELECT 1 FROM agent_mailbox_sends AS sends
    WHERE sends.mailbox_id = audit.mailbox_id
      AND sends.idempotency_key = audit.idempotency_key
);

ALTER TABLE agent_mailbox_sends
    ALTER COLUMN outcome SET NOT NULL,
    ALTER COLUMN reserved_at SET NOT NULL,
    ALTER COLUMN updated_at SET NOT NULL,
    ADD CONSTRAINT agent_mailbox_sends_outcome_check
        CHECK (outcome IN ('pending', 'sent', 'refused')),
    ADD CONSTRAINT agent_mailbox_sends_attempts_check CHECK (attempts > 0),
    ADD CONSTRAINT agent_mailbox_sends_sent_check
        CHECK ((outcome = 'sent') = (provider_message_id IS NOT NULL)),
    -- Records outlive nothing now: mailboxes are never deleted, and the
    -- records go only by retention.
    DROP CONSTRAINT agent_mailbox_sends_mailbox_id_fkey,
    ADD CONSTRAINT agent_mailbox_sends_mailbox_id_fkey
        FOREIGN KEY (mailbox_id) REFERENCES agent_mailboxes (id);

DROP INDEX agent_mailbox_sends_window_idx;
DROP INDEX agent_mailbox_sends_team_window_idx;
DROP INDEX agent_mailbox_sends_created_idx;
ALTER TABLE agent_mailbox_sends DROP COLUMN created_at;

-- The caps' windows: counted sends of one mailbox, and of one team.
CREATE INDEX agent_mailbox_sends_window_idx
    ON agent_mailbox_sends (mailbox_id, reserved_at)
    WHERE outcome <> 'refused';

CREATE INDEX agent_mailbox_sends_team_window_idx
    ON agent_mailbox_sends (team_id, reserved_at)
    WHERE outcome <> 'refused';

-- Pruning records past their retention.
CREATE INDEX agent_mailbox_sends_reserved_idx
    ON agent_mailbox_sends (reserved_at);

DROP TABLE agent_mailbox_send_audit;

-- Pruning is claimed by one replica per round, like the orphan check.
ALTER TABLE agent_mailbox_sweep_claims
    DROP CONSTRAINT agent_mailbox_sweep_claims_name_check,
    ADD CONSTRAINT agent_mailbox_sweep_claims_name_check
        CHECK (name IN ('orphans', 'prune'));

INSERT INTO agent_mailbox_sweep_claims (name, next_run_at)
VALUES ('prune', '-infinity')
ON CONFLICT (name) DO NOTHING;
