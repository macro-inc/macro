SELECT el.id, el.macro_id,
       COALESCE(array_remove(d.primaries, el.macro_id), '{}') AS "delegates!"
FROM email_links el
LEFT JOIN (
    SELECT mul.link_id, array_agg(mul.primary_macro_id) AS primaries
    FROM macro_user_links mul
    GROUP BY mul.link_id
) d ON d.link_id = el.id
WHERE el.is_sync_active
