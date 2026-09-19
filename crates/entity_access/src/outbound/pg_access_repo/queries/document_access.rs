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
