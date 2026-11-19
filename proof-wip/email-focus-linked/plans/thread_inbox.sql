
            SELECT t.id, t.link_id, t.is_signal, t.inbox_visible, el.macro_id, el.email_address,
                   -- The other users whose Focus tab lists the inbox, as
                   -- focus_thread_ids reads it for them: an index probe on
                   -- macro_user_links_link_idx, sorted and deduplicated in
                   -- `delegates` rather than once per inbox here.
                   -- inboxes_with_focus and syncing_inboxes restate it;
                   -- change all three.
                   ARRAY(
                       SELECT mul.primary_macro_id
                       FROM macro_user_links mul
                       WHERE mul.link_id = t.link_id AND mul.primary_macro_id <> el.macro_id
                   ) AS "delegates!",
                   f.classified_message_id AS "classified_message_id?",
                   f.rule_version AS "rule_version?",
                   f.scores AS "scores?",
                   f.model AS "model?",
                   f.due_on AS "due_on?"
            FROM email_threads t
            JOIN email_links el ON el.id = t.link_id
            LEFT JOIN email_thread_focus f ON f.thread_id = t.id
            WHERE t.id = $1
            