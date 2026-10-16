-- A withdrawal can arrive before the queued notification is persisted.
CREATE TABLE notification_withdrawal (
    notification_id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);
