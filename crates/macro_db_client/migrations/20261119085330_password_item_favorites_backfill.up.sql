-- no-transaction
-- Keyset pages commit independently; do not retain the schema migration's FK
-- locks throughout this one-time backfill. Retries are idempotent.
DO $$
DECLARE
    cursor_team UUID := '00000000-0000-0000-0000-000000000000';
    cursor_item UUID := '00000000-0000-0000-0000-000000000000';
    next_team UUID;
    next_item UUID;
BEGIN
    LOOP
        PERFORM set_config('lock_timeout', '2s', true);
        WITH page AS MATERIALIZED (
            SELECT team_id, id, user_id, metadata->>'favorite' = 'true' AS favorite
            FROM password_item_entities
            WHERE (team_id, id) > (cursor_team, cursor_item)
            ORDER BY team_id, id
            LIMIT 1000
        ), eligible AS MATERIALIZED (
            SELECT page.team_id, page.id, page.user_id
            FROM page
            JOIN LATERAL (
                SELECT id,deleting,deleted_at FROM password_item_entities
                WHERE team_id=page.team_id AND id=page.id
                OFFSET 0 FOR SHARE
            ) item ON true
            JOIN LATERAL (
                SELECT user_id FROM team_user
                WHERE team_id=page.team_id AND user_id=page.user_id
                FOR KEY SHARE
            ) membership ON true
            WHERE page.favorite AND NOT item.deleting AND item.deleted_at IS NULL
        ), inserted AS (
            INSERT INTO password_item_favorites(team_id, item_id, user_id)
            SELECT team_id, id, user_id FROM eligible
            ON CONFLICT DO NOTHING
        )
        SELECT team_id, id INTO next_team, next_item FROM page ORDER BY team_id DESC, id DESC LIMIT 1;
        IF NOT FOUND THEN EXIT; END IF;
        cursor_team := next_team;
        cursor_item := next_item;
        COMMIT;
    END LOOP;
END $$;
