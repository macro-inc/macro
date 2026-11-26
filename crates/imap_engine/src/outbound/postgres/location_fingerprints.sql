WITH requested AS MATERIALIZED (
    SELECT DISTINCT fingerprint
    FROM unnest($2::bytea[]) AS keys(fingerprint)
)
SELECT locations.key, locations.document, locations.fingerprint
FROM requested
CROSS JOIN LATERAL (
    SELECT key, document, fingerprint
    FROM imap_state_entries
    WHERE link_id = $1
        AND kind = 'location'
        AND fingerprint = requested.fingerprint
    OFFSET 0
) locations
ORDER BY locations.key COLLATE "C"
