SELECT EXISTS( SELECT 1 FROM macro_user_links WHERE primary_macro_id = $1 AND child_macro_id = $2 AND link_id = $3 ) AS "exists!"
