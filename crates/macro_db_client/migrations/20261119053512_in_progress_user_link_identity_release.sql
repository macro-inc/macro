-- A Google connect links the mailbox's Google identity to a FusionAuth user at
-- the OAuth callback. When that identity was linked by this attempt (and the
-- mailbox has no account of its own), an attempt that ends without an inbox
-- must release it, or no other account can connect the mailbox. A refused
-- attempt is kept, marked, until the auth service releases its identity.
SET LOCAL lock_timeout = '5s';

ALTER TABLE in_progress_user_link
    ADD COLUMN identity_link_created BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN refused_at TIMESTAMPTZ;
