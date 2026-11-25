SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

-- When Microsoft last refused this grant's refresh (reconnect required or the
-- mail permissions missing). A refused grant is kept, not revoked: the sign-in
-- service answers it as needing a reconnect without asking Microsoft again
-- for an hour, and a refresh that works clears it.
ALTER TABLE microsoft_oauth_grant_versions ADD COLUMN refresh_refused_at timestamptz;
