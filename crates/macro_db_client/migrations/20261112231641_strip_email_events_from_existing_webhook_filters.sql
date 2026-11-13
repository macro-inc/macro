-- Email events become deliverable in the release that follows this
-- migration, and only to subscriptions made with the inbox owner's own
-- credential. Filter event names were free-form before, so a webhook stored
-- earlier may already name `email.*` events without having passed that check
-- (the row does not record which kind of credential created it). No email
-- event was ever delivered to such a webhook, so remove those names: the
-- owner subscribes again through the checked route.
--
-- `webhook` holds one row per registered webhook and stays small. The
-- statement rewrites only rows naming an `email.*` event, in one short
-- transaction with no DDL.
SET LOCAL lock_timeout = '5s';

UPDATE webhook AS w
SET
    filters = COALESCE(
        (
            SELECT jsonb_agg(jsonb_set(f.filter, '{events}', kept.events) ORDER BY f.position)
            FROM jsonb_array_elements(w.filters) WITH ORDINALITY AS f(filter, position)
            CROSS JOIN LATERAL (
                SELECT jsonb_path_query_array(
                    f.filter -> 'events',
                    '$[*] ? (!(@ starts with "email."))'
                ) AS events
            ) AS kept
            WHERE jsonb_array_length(kept.events) > 0
        ),
        '[]'::jsonb
    ),
    updated_at = now()
WHERE w.filters @? '$[*].events[*] ? (@ starts with "email.")';
