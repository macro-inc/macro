-- Notification stacks: a person's own rules that route a notification, per
-- recipient and before delivery, into a lane. Signal is delivered as before.
-- Noise is stored but never pushed, digested or counted as unread.

-- Fail fast instead of queueing other sessions behind this migration. It
-- takes two table locks: on "User", for the new table's foreign key, and on
-- user_notification, for the new columns. Set first, so neither wait is
-- unbounded and no lock is held while the other is waited for longer than
-- this.
SET LOCAL lock_timeout = '5s';

CREATE TYPE notification_lane AS ENUM ('signal', 'noise');

-- One stack: capture rules decide which notifications it takes, release rules
-- which of those go back to Signal. Stacks evaluate in `position` order and the
-- first capture wins. `revision` counts edits, so a routed notification can
-- name the rules that routed it.
CREATE TABLE notification_stack (
    id uuid PRIMARY KEY,
    user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    name text NOT NULL,
    position integer NOT NULL,
    lane notification_lane NOT NULL,
    capture jsonb NOT NULL,
    release jsonb NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    revision integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_stack_user ON notification_stack (user_id, position);

-- The lane is decided once, at ingress, and lives on the recipient's row like
-- the copied entity columns: every reader filters on it. The constant default
-- adds the column without rewriting the table. `stack_id` has no foreign key:
-- deleting a stack must not scan this table, so the stack's owner clears it.
ALTER TABLE user_notification
    ADD COLUMN lane notification_lane NOT NULL DEFAULT 'signal',
    ADD COLUMN stack_id uuid,
    ADD COLUMN routing jsonb;

COMMENT ON COLUMN user_notification.lane IS
    'Signal or noise, decided at ingress. Every reader of active rows excludes noise unless it asks for it.';
COMMENT ON COLUMN user_notification.stack_id IS
    'The notification_stack that captured this row, when one did. Not a foreign key.';
COMMENT ON COLUMN user_notification.routing IS
    'How ingress routed this row: stack revision, matched rule and outcome. Null when no stack was evaluated.';
