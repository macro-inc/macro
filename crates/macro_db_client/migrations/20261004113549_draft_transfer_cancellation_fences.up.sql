-- A recovery request can arrive before the original HTTP request reaches storage.
-- Keep cancellations independently of inbox lifetime and before any transfer exists.
CREATE TABLE email_draft_transfer_cancellations (
    id uuid PRIMARY KEY,
    actor_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
