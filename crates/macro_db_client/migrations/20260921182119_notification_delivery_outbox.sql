-- Add migration script here
-- A durable notification delivery request is created in the same transaction as
-- the notification and its recipient rows. The request is expanded into
-- independently publishable channel intents by notification-service.
CREATE TABLE notification_delivery_outbox
(
    notification_id UUID PRIMARY KEY NOT NULL
        REFERENCES notification (id) ON DELETE CASCADE,
    generation      UUID             NOT NULL,
    request          JSONB            NOT NULL,
    prepared_at      TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    claim_token      UUID,
    claim_expires_at TIMESTAMPTZ,
    attempt_count    INTEGER          NOT NULL DEFAULT 0,
    next_attempt_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    CONSTRAINT notification_delivery_outbox_claim_pair CHECK (
        (claim_token IS NULL) = (claim_expires_at IS NULL)
    )
);

CREATE INDEX notification_delivery_outbox_pending_idx
    ON notification_delivery_outbox (next_attempt_at, created_at)
    WHERE completed_at IS NULL;

-- Each prepared queue payload advances independently so a later channel failure
-- never causes an already-published channel to be sent again on ordinary retry.
CREATE TABLE notification_delivery_outbox_intent
(
    notification_id UUID        NOT NULL,
    position        INTEGER     NOT NULL CHECK (position >= 0),
    payload         JSONB       NOT NULL,
    published_at    TIMESTAMPTZ,
    claim_token     UUID,
    claim_expires_at TIMESTAMPTZ,
    attempt_count   INTEGER     NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, position),
    CONSTRAINT notification_delivery_outbox_intent_parent
        FOREIGN KEY (notification_id)
        REFERENCES notification_delivery_outbox (notification_id)
        ON DELETE CASCADE,
    CONSTRAINT notification_delivery_outbox_intent_claim_pair CHECK (
        (claim_token IS NULL) = (claim_expires_at IS NULL)
    )
);

CREATE INDEX notification_delivery_outbox_intent_pending_idx
    ON notification_delivery_outbox_intent (next_attempt_at, created_at)
    WHERE published_at IS NULL;

-- Redis digest idempotency receipts must survive until no preparation claimant
-- can still perform the side effect. These cleanup records intentionally do not
-- reference notification: notification deletion cancels channel delivery through
-- the cascades above, while this row must remain briefly to remove external Redis
-- state before deleting itself.
CREATE TABLE notification_digest_receipt_cleanup
(
    notification_id UUID        NOT NULL,
    user_id          TEXT        NOT NULL,
    generation       UUID        NOT NULL,
    safe_after       TIMESTAMPTZ,
    claim_token      UUID,
    claim_expires_at TIMESTAMPTZ,
    attempt_count    INTEGER     NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, user_id, generation),
    CONSTRAINT notification_digest_receipt_cleanup_claim_pair CHECK (
        (claim_token IS NULL) = (claim_expires_at IS NULL)
    )
);

CREATE INDEX notification_digest_receipt_cleanup_pending_idx
    ON notification_digest_receipt_cleanup (safe_after, created_at)
    WHERE safe_after IS NOT NULL;
