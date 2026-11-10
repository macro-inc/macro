INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES ($1, $2, $3) ON CONFLICT (primary_macro_id, child_macro_id, link_id) DO NOTHING
