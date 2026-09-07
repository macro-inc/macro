//! Query for document access level.

#[cfg(test)]
mod test;

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a user has for a document.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_document_access(
    pool: &PgPool,
    document_id: &uuid::Uuid,
    source_ids: &SourceIds,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if source_ids.0.is_empty() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
                share_permission."linkShareAccessLevel" AS "access_level!: AccessLevel"
            FROM "SharePermission" share_permission
            JOIN "DocumentPermission" document_permission
              ON document_permission."sharePermissionId" = share_permission.id
            WHERE share_permission."linkShare" = 'PUBLIC'
              AND share_permission."linkShareAccessLevel" IS NOT NULL
              AND document_permission."documentId" = $1
            "#,
            &document_id.to_string()
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level);
    }

    let user_id_str = user_id.map(AsRef::as_ref).unwrap_or("");

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'document'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: document link share permission
            SELECT
                share_permission."linkShareAccessLevel"::text AS access_level
            FROM "Document" document
            JOIN "DocumentPermission" document_permission
              ON document_permission."documentId" = document.id
            JOIN "SharePermission" share_permission
              ON share_permission.id = document_permission."sharePermissionId"
            WHERE document.id = $3
              AND share_permission."linkShareAccessLevel" IS NOT NULL
              AND (
                  share_permission."linkShare" = 'PUBLIC'
                  OR (
                      share_permission."linkShare" = 'TEAM'
                      AND EXISTS (
                          SELECT 1
                          FROM team_user owner_team
                          WHERE owner_team.user_id = document.owner
                            AND owner_team.team_id::text = ANY($2)
                      )
                  )
              )

            UNION ALL
            -- Source 3: email-attachment documents inherit access from any
            -- linked thread the caller can reach. Owning or being delegated
            -- the thread's inbox (macro_user_links) grants Edit, mirroring
            -- calendar-event delegation. A thread-level entity_access grant
            -- inherits as View regardless of its level: a SHA-deduped document
            -- can back attachments in other threads with different audiences,
            -- so a per-thread share must not confer write access to it.
            SELECT CASE
                WHEN l.macro_id = $4
                  OR EXISTS (
                      SELECT 1
                      FROM macro_user_links mul
                      WHERE mul.link_id = l.id
                        AND mul.primary_macro_id = $4
                  )
                THEN 'edit'
                ELSE 'view'
            END AS access_level
            FROM document_email de
            JOIN email_attachments ea ON ea.id = de.email_attachment_id
            JOIN email_messages em ON em.id = ea.message_id
            JOIN email_threads t ON t.id = em.thread_id
            JOIN email_links l ON l.id = t.link_id
            WHERE de.document_id = $3
              AND (
                  l.macro_id = $4
                  OR EXISTS (
                      SELECT 1
                      FROM macro_user_links mul
                      WHERE mul.link_id = l.id
                        AND mul.primary_macro_id = $4
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM entity_access thread_access
                      WHERE thread_access.entity_id = t.id
                        AND thread_access.entity_type = 'email_thread'
                        AND thread_access.source_id = ANY($2)
                  )
              )
            UNION ALL
            -- A file attached to an internal discussion is visible to current
            -- viewers of its parent. Removing the attachment, discussion, or
            -- parent grant removes this path; it never shares the parent itself.
            SELECT 'view' AS access_level
            FROM comms_attachments a JOIN comms_messages m ON m.id = a.message_id
            JOIN comms_message_threads mt ON mt.root_id = COALESCE(m.thread_id, m.id)
            JOIN "Document" parent_doc ON m.parent_entity_type = 'document' AND parent_doc.id = m.parent_entity_id
            LEFT JOIN "DocumentPermission" dp ON dp."documentId" = parent_doc.id
            LEFT JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
            WHERE a.entity_type = 'document' AND a.entity_id = $3 AND m.deleted_at IS NULL AND mt.deleted_at IS NULL
                AND parent_doc."deletedAt" IS NULL AND (
                        parent_doc.owner = $4
                        OR EXISTS (SELECT 1 FROM entity_access pa WHERE pa.entity_type = 'document'
                            AND pa.entity_id::text = parent_doc.id AND pa.source_id = ANY($2))
                        OR (sp."linkShareAccessLevel" IS NOT NULL AND (sp."linkShare" = 'PUBLIC'
                            OR (sp."linkShare" = 'TEAM' AND EXISTS (SELECT 1 FROM team_user tu WHERE tu.user_id = parent_doc.owner AND tu.team_id::text = ANY($2)))))
                )
        ) AS combined_access
        "#,
        document_id,
        &source_ids.0,
        &document_id.to_string(),
        user_id_str,
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

/// Historical document IDs are strings and cannot occur in UUID entity_access
/// rows. Their ownership, link grants, channel grants and project grants still
/// live in the ordinary document/share tables.
pub async fn get_legacy_document_access(
    pool: &PgPool,
    document_id: &str,
    source_ids: &SourceIds,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels = sqlx::query_scalar!(r#"
        WITH RECURSIVE parent_projects AS (
            SELECT p.id, p."parentId", p."userId" FROM "Project" p
            JOIN "Document" d ON d."projectId" = p.id WHERE d.id = $1 AND d."deletedAt" IS NULL AND p."deletedAt" IS NULL
            UNION
            SELECT p.id, p."parentId", p."userId" FROM "Project" p JOIN parent_projects child ON p.id = child."parentId" WHERE p."deletedAt" IS NULL
        ), document_permissions AS (
            SELECT d.owner, sp.id, sp."linkShare", sp."linkShareAccessLevel" FROM "Document" d
            LEFT JOIN "DocumentPermission" dp ON dp."documentId" = d.id
            LEFT JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
            WHERE d.id = $1 AND d."deletedAt" IS NULL
        )
        SELECT 'owner'::text AS "level!" FROM document_permissions WHERE owner = $2
        UNION ALL
        SELECT "linkShareAccessLevel"::text FROM document_permissions p
        WHERE "linkShareAccessLevel" IS NOT NULL AND ("linkShare" = 'PUBLIC'
            OR ("linkShare" = 'TEAM' AND EXISTS (SELECT 1 FROM team_user t WHERE t.user_id = p.owner AND t.team_id::text = ANY($3))))
        UNION ALL
        SELECT c.access_level::text FROM document_permissions p
        JOIN "ChannelSharePermission" c ON c.share_permission_id = p.id WHERE c.channel_id = ANY($3)
        UNION ALL
        SELECT 'edit'::text FROM parent_projects WHERE "userId" = $2
        UNION ALL
        SELECT a.access_level::text FROM entity_access a JOIN parent_projects p ON a.entity_id::text = p.id
        WHERE a.entity_type = 'project' AND a.source_id = ANY($3)
    "#, document_id, user_id.map(AsRef::as_ref), &source_ids.0).fetch_all(pool).await?;
    Ok(levels
        .iter()
        .filter_map(|level| AccessLevel::from_str(level).ok())
        .max())
}
