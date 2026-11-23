SELECT
    a.id AS "id!",
    a.message_id AS "message_id!",
    a.provider_attachment_id,
    a.filename,
    a.mime_type,
    a.size_bytes,
    a.content_id,
    a.created_at AS "created_at!",
    m.thread_id AS "thread_id!"
FROM
    (SELECT DISTINCT thread_id FROM UNNEST($1::uuid[]) AS ids(thread_id)) t
CROSS JOIN LATERAL (
    SELECT m.id, m.thread_id
    FROM email_messages m
    WHERE m.thread_id = t.thread_id
    OFFSET 0
) m
CROSS JOIN LATERAL (
    SELECT
        a.id,
        a.message_id,
        a.provider_attachment_id,
        a.filename,
        a.mime_type,
        a.size_bytes,
        a.content_id,
        a.created_at
    FROM email_attachments a
    WHERE a.message_id = m.id
    OFFSET 0
) a
ORDER BY
    a.created_at ASC
