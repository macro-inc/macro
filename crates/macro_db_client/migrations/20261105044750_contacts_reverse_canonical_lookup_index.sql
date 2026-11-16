-- no-transaction
-- The reverse point-read direction needs the raw viewer as its leading key too.
-- Keep each concurrent index build in its own nontransactional migration.
CREATE INDEX CONCURRENTLY idx_contacts_connections_user2_peer_ci
    ON contacts_connections (user2, lower(user1 COLLATE "C"))
    WHERE user1 COLLATE "C" LIKE 'macro|%';
