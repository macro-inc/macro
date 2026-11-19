SELECT el.id, el.macro_id,
       ARRAY(
           SELECT mul.primary_macro_id
           FROM macro_user_links mul
           WHERE mul.link_id = el.id AND mul.primary_macro_id <> el.macro_id
       ) AS "delegates!"
FROM email_links el
WHERE el.is_sync_active
