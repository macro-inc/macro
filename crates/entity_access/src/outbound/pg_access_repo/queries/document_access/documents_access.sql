-- Every grant one signed-in caller holds on each of many documents: the four
-- sources of `get_document_access`. Keep each source's conditions equivalent
-- to that query's; the caller takes the highest level per document, as
-- `get_document_access` does.
--
-- Membership is checked without the caller's source list. The requested
-- documents' grants are read once, and each distinct grant source is checked
-- once, since a project's tasks share a few sources; source 1 joins on the
-- sources that matched. Team links compare the owner's teams with the
-- caller's, read once: a team id is never a user or channel id, so that is the
-- team part of `entity_access_source_matches`.
--
-- Sources 2 to 4 are checked for each requested document in turn. The OFFSET 0
-- fences keep their plan to index lookups from each requested document and
-- each of its attachments, whatever the row estimates. Without them, stale
-- statistics on the attachment tables led the planner to hash whole email and
-- discussion tables.
--
-- $1: document ids, $2: the caller's user id.
WITH requested_grants AS MATERIALIZED (
    SELECT entity_id, source_id, access_level
    FROM entity_access
    WHERE entity_id = ANY($1)
      AND entity_type = 'document'
),
viewer_grant_sources AS MATERIALIZED (
    SELECT sources.source_id
    FROM (SELECT DISTINCT source_id FROM requested_grants) AS sources
    WHERE EXISTS (SELECT FROM entity_access_source_matches(sources.source_id, $2, NULL::uuid))
)
-- Source 1: entity_access source_id match
SELECT
    requested_grants.entity_id AS "document_id!",
    requested_grants.access_level AS "access_level!: AccessLevel"
FROM requested_grants
WHERE requested_grants.source_id IN (SELECT source_id FROM viewer_grant_sources)

UNION ALL

SELECT requested.id, grants.access_level
FROM (
    -- The document and attachment tables key documents by text, in the
    -- canonical form `uuid::text` produces.
    SELECT id, id::text AS document_id
    FROM unnest($1::uuid[]) AS ids(id)
) AS requested
CROSS JOIN LATERAL (
    SELECT access_level
    FROM (
        -- Source 2: document link share permission
        SELECT share_permission."linkShareAccessLevel" AS access_level
        FROM "Document" document
        JOIN "DocumentPermission" document_permission
          ON document_permission."documentId" = document.id
        JOIN "SharePermission" share_permission
          ON share_permission.id = document_permission."sharePermissionId"
        WHERE document.id = requested.document_id
          AND share_permission."linkShareAccessLevel" IS NOT NULL
          AND (
              share_permission."linkShare" = 'PUBLIC'
              OR (
                  share_permission."linkShare" = 'TEAM'
                  AND EXISTS (
                      SELECT 1
                      FROM owner_team(document.owner) owner_team
                      WHERE owner_team.team_id = ANY(ARRAY(
                          SELECT viewer_team.team_id FROM team_user viewer_team WHERE viewer_team.user_id = $2
                      ))
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
                l.macro_id = $2
                  OR EXISTS (
                      SELECT 1
                      FROM macro_user_links mul
                      WHERE mul.link_id = l.id
                        AND mul.primary_macro_id = $2
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
                    AND EXISTS (
                        SELECT FROM entity_access_source_matches(thread_access.source_id, $2, NULL::uuid)
                    )
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
            LEFT JOIN "DocumentPermission" dp ON dp."documentId" = parent_doc.id
            LEFT JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
            WHERE m.id = a.message_id
              AND m.deleted_at IS NULL
              AND mt.deleted_at IS NULL
              AND parent_doc."deletedAt" IS NULL
              AND (
                  parent_doc.owner = $2
                  OR EXISTS (
                      SELECT 1
                      FROM entity_access pa
                      WHERE pa.entity_type = 'document'
                        AND pa.entity_id::text = parent_doc.id
                        AND EXISTS (
                            SELECT FROM entity_access_source_matches(pa.source_id, $2, NULL::uuid)
                        )
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
                                  WHERE tu.team_id = ANY(ARRAY(
                                      SELECT viewer_team.team_id FROM team_user viewer_team WHERE viewer_team.user_id = $2
                                  ))
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
