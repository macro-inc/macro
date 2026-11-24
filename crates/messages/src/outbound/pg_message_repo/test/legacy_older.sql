-- Preserve the previous timeline selection for independent rewrite regression coverage.
SELECT m.id FROM comms_messages m
            JOIN comms_message_threads t ON t.root_id = m.id
            WHERE m.parent_entity_type = $1 AND m.parent_entity_id = $2
                AND m.thread_id IS NULL AND (t.deleted_at IS NULL OR $10)
                AND (m.deleted_at IS NULL OR $1 = 'document' OR ($10 AND t.deleted_at IS NOT NULL) OR EXISTS (
                    SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL))
                AND ($6::uuid[] IS NULL OR m.id = ANY($6))
                AND ($7::bool IS NULL OR (t.anchor IS NOT NULL) = $7)
                AND (($8::timestamptz IS NULL AND $9::timestamptz IS NULL)
                    OR (($8::timestamptz IS NULL OR m.created_at >= $8) AND ($9::timestamptz IS NULL OR m.created_at < $9))
                    OR EXISTS (SELECT 1 FROM comms_messages r WHERE r.thread_id = m.id AND r.deleted_at IS NULL
                        AND ($8::timestamptz IS NULL OR r.created_at >= $8) AND ($9::timestamptz IS NULL OR r.created_at < $9)))
                AND ($3::timestamptz IS NULL OR (m.created_at, m.id) < ($3, $4::uuid))
            ORDER BY m.created_at DESC, m.id DESC LIMIT $5
