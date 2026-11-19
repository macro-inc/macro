
            WITH RECURSIVE focus_links AS (
                (
                    SELECT f.link_id
                    FROM email_thread_focus f
                    WHERE f.is_focus
                    ORDER BY f.link_id
                    LIMIT 1
                )
                UNION ALL
                SELECT (
                    SELECT f.link_id
                    FROM email_thread_focus f
                    WHERE f.is_focus AND f.link_id > l.link_id
                    ORDER BY f.link_id
                    LIMIT 1
                )
                FROM focus_links l
                WHERE l.link_id IS NOT NULL
            )
            SELECT el.id, el.macro_id,
                   ARRAY(
                       SELECT mul.primary_macro_id
                       FROM macro_user_links mul
                       WHERE mul.link_id = el.id AND mul.primary_macro_id <> el.macro_id
                   ) AS "delegates!"
            FROM focus_links l
            JOIN email_links el ON el.id = l.link_id
            