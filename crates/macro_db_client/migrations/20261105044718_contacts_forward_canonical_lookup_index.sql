-- no-transaction
-- Preserve the raw viewer key and match the peer's supported ASCII case aliases.
-- Invalid marker casing is not a Macro identity. C folding also leaves invalid
-- Unicode aliases unchanged, rather than turning them into authorized ASCII IDs.
CREATE INDEX CONCURRENTLY idx_contacts_connections_user1_peer_ci
    ON contacts_connections (user1, lower(user2 COLLATE "C"))
    WHERE user2 COLLATE "C" LIKE 'macro|%';
