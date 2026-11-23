-- Every grant one signed-in caller holds on each of many documents: the four
-- sources of `get_document_access`, checked for each requested id in turn.
-- Keep each source's conditions equivalent to that query's; the caller takes
-- the highest level per document, as `get_document_access` does.
--
-- The OFFSET 0 fences keep the plan to index lookups from each requested
-- document, attachment, and inherited grant. Fence correlated EXISTS checks too:
-- otherwise the planner can hash every grant matching the caller's sources.
-- Stale attachment statistics must not select whole email or discussion tables.
--
-- $1: document ids, $2: the caller's source ids, $3: the caller's user id.
SELECT
    requested.id AS "document_id!",
    grants.access_level AS "access_level!: AccessLevel"
FROM (
    -- The document and attachment tables key documents by text, in the
    -- canonical form `uuid::text` produces.
    SELECT id, id::text AS document_id
    FROM unnest($1::uuid[]) AS ids(id)
) AS requested
CROSS JOIN LATERAL (
    SELECT access_level
    FROM (
        -- Source 1: entity_access source_id match
        SELECT access_level
        FROM entity_access
        WHERE entity_id = requested.id
          AND entity_type = 'document'
          AND source_id = ANY($2)

        UNION ALL
        -- Source 2: document link share permission
        SELECT share_permission."linkShareAccessLevel"
        FROM (
            SELECT owner FROM "Document" WHERE id = requested.document_id OFFSET 0
        ) document
        CROSS JOIN LATERAL (
            SELECT "sharePermissionId" FROM "DocumentPermission"
            WHERE "documentId" = requested.document_id OFFSET 0
        ) document_permission
        CROSS JOIN LATERAL (
            SELECT "linkShare", "linkShareAccessLevel" FROM "SharePermission"
            WHERE id = document_permission."sharePermissionId" OFFSET 0
        ) share_permission
        WHERE share_permission."linkShareAccessLevel" IS NOT NULL
          AND (
              share_permission."linkShare" = 'PUBLIC'
              OR (
                  share_permission."linkShare" = 'TEAM'
                  AND EXISTS (
                      SELECT 1
                      FROM owner_team(document.owner) owner_team
                      WHERE owner_team.team_id::text = ANY($2)
                  )
              )
          )

        UNION ALL
        -- Source 3: email-attachment documents inherit access from any linked
        -- thread the caller can reach: Edit for the inbox's owner or delegate,
        -- View through a thread-level grant of any level.
        SELECT
            CASE
                WHEN inbox.owned THEN 'edit'::"AccessLevel"
                ELSE 'view'::"AccessLevel"
            END
        FROM document_email de
        CROSS JOIN LATERAL (
            -- The attachment's thread and inbox, by primary keys.
            SELECT
                t.id AS thread_id,
                l.macro_id = $3
                  OR EXISTS (
                      SELECT 1
                      FROM macro_user_links mul
                      WHERE mul.link_id = l.id
                        AND mul.primary_macro_id = $3
                  ) AS owned
            FROM email_attachments ea
            JOIN email_messages em ON em.id = ea.message_id
            JOIN email_threads t ON t.id = em.thread_id
            JOIN email_links l ON l.id = t.link_id
            WHERE ea.id = de.email_attachment_id
            OFFSET 0
        ) AS inbox
        WHERE de.document_id = requested.document_id
          AND (
              inbox.owned
              OR EXISTS (
                  SELECT 1
                  FROM entity_access thread_access
                  WHERE thread_access.entity_id = inbox.thread_id
                    AND thread_access.entity_type = 'email_thread'
                    AND thread_access.source_id = ANY($2)
                  OFFSET 0
              )
          )

        UNION ALL
        -- Source 4: a file attached to a document discussion is visible to
        -- current viewers of that document.
        SELECT 'view'::"AccessLevel"
        FROM comms_attachments a
        CROSS JOIN LATERAL (
            -- The attachment's live message, thread and parent document, by keys.
            SELECT 1
            FROM (
                -- By primary key alone: given the parent and deletion filters,
                -- the planner can prefer a partial index on the parent type,
                -- which reads every document discussion.
                SELECT m.id, m.thread_id, m.parent_entity_type, m.parent_entity_id, m.deleted_at
                FROM comms_messages m
                WHERE m.id = a.message_id
                OFFSET 0
            ) AS m
            JOIN comms_message_threads mt ON mt.root_id = COALESCE(m.thread_id, m.id)
            JOIN "Document" parent_doc
              ON m.parent_entity_type = 'document' AND parent_doc.id = m.parent_entity_id
            LEFT JOIN LATERAL (
                SELECT "sharePermissionId" FROM "DocumentPermission"
                WHERE "documentId" = parent_doc.id OFFSET 0
            ) dp ON TRUE
            LEFT JOIN LATERAL (
                SELECT "linkShare", "linkShareAccessLevel" FROM "SharePermission"
                WHERE id = dp."sharePermissionId" OFFSET 0
            ) sp ON TRUE
            WHERE m.id = a.message_id
              AND m.deleted_at IS NULL
              AND mt.deleted_at IS NULL
              AND parent_doc."deletedAt" IS NULL
              AND (
                  parent_doc.owner = $3
                  OR EXISTS (
                      SELECT 1
                      FROM entity_access pa
                      WHERE pa.entity_type = 'document'
                        AND pa.entity_id::text = parent_doc.id
                        AND pa.source_id = ANY($2)
                      OFFSET 0
                  )
                  OR (
                      sp."linkShareAccessLevel" IS NOT NULL
                      AND (
                          sp."linkShare" = 'PUBLIC'
                          OR (
                              sp."linkShare" = 'TEAM'
                              AND EXISTS (
                                  SELECT 1
                                  FROM owner_team(parent_doc.owner) tu
                                  WHERE tu.team_id::text = ANY($2)
                              )
                          )
                      )
                  )
              )
            OFFSET 0
        ) AS visible
        WHERE a.entity_type = 'document'
          AND a.entity_id = requested.document_id
    ) AS sources
    OFFSET 0
) AS grants
