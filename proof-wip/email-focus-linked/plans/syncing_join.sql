SELECT el.id, el.macro_id,
       COALESCE(
           array_agg(DISTINCT mul.primary_macro_id ORDER BY mul.primary_macro_id)
               FILTER (WHERE mul.primary_macro_id IS NOT NULL),
           '{}'
       ) AS "delegates!"
FROM email_links el
LEFT JOIN macro_user_links mul ON mul.link_id = el.id AND mul.primary_macro_id <> el.macro_id
WHERE el.is_sync_active
GROUP BY el.id
