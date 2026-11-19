SELECT mul.link_id, mul.primary_macro_id
FROM macro_user_links mul
JOIN email_links el ON el.id = mul.link_id
WHERE el.is_sync_active AND mul.primary_macro_id <> el.macro_id
