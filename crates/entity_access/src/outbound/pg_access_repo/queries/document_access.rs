//! Query for document access level.

#[cfg(test)]
mod test;

#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::AccessGrant, outbound::pg_access_repo::queries::list_entity_access_grants,
};
use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::Viewer};
#[cfg(feature = "explain_binary")]
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;
use std::str::FromStr;

/// Get the highest access level a viewer has for a document.
#[tracing::instrument(err, skip(pool, viewer))]
pub(crate) async fn get_document_access(
    pool: &PgPool,
    document_id: &uuid::Uuid,
    viewer: Viewer<'_>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if viewer.is_anonymous() {
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

    // A separate statement on purpose: an owner grant settles the result, and
    // planning the union below costs more than executing it.
    let is_direct_owner = sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM entity_access
            WHERE entity_id = $1
              AND entity_type = 'document'
              AND access_level = 'owner'
              AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $2, $3))
        ) AS "is_direct_owner!"
        "#,
        document_id,
        viewer.id(),
        viewer.scope_team(),
    )
    .fetch_one(pool)
    .await?;

    if is_direct_owner {
        return Ok(Some(AccessLevel::Owner));
    }

    // A bot reaches documents only through grants, never as an inbox owner.
    let user_id_str = viewer.user_id().unwrap_or("");

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'document'
            AND EXISTS (SELECT FROM entity_access_source_matches(source_id, $2, $5))

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
                          FROM owner_team(document.owner) owner_team
                          WHERE EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, $2, $5))
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
                        AND EXISTS (SELECT FROM entity_access_source_matches(thread_access.source_id, $2, $5))
                  )
              )

            UNION ALL
            -- Source 4: a file attached to a document discussion is visible to
            -- current viewers of that document. Removing the attachment, the
            -- discussion, or the parent grant removes this path; it never
            -- shares the parent itself.
            SELECT 'view' AS access_level
            FROM comms_attachments a
            JOIN comms_messages m ON m.id = a.message_id
            JOIN comms_message_threads mt ON mt.root_id = COALESCE(m.thread_id, m.id)
            JOIN "Document" parent_doc
              ON m.parent_entity_type = 'document' AND parent_doc.id = m.parent_entity_id
            LEFT JOIN "DocumentPermission" dp ON dp."documentId" = parent_doc.id
            LEFT JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
            WHERE a.entity_type = 'document'
              AND a.entity_id = $3
              AND m.deleted_at IS NULL
              AND mt.deleted_at IS NULL
              AND parent_doc."deletedAt" IS NULL
              AND (
                  parent_doc.owner = $4
                  OR EXISTS (
                      SELECT 1
                      FROM entity_access pa
                      WHERE pa.entity_type = 'document'
                        AND pa.entity_id::text = parent_doc.id
                        AND EXISTS (SELECT FROM entity_access_source_matches(pa.source_id, $2, $5))
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
                                  WHERE EXISTS (SELECT FROM entity_access_source_matches(tu.team_id::text, $2, $5))
                              )
                          )
                      )
                  )
              )
        ) AS combined_access
        "#,
        document_id,
        viewer.id(),
        &document_id.to_string(),
        user_id_str,
        viewer.scope_team(),
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, user_id))]
pub async fn explain_document_access(
    pool: &PgPool,
    document_id: &uuid::Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants =
        list_entity_access_grants(pool, document_id, EntityType::Document, user_id).await?;
    grants.extend(explain_document_link_shares(pool, document_id, user_id).await?);
    grants.extend(explain_document_email_attachments(pool, document_id, user_id).await?);

    Ok(grants)
}

#[cfg(feature = "explain_binary")]
async fn explain_document_link_shares(
    pool: &PgPool,
    document_id: &uuid::Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let document_id_str = document_id.to_string();
    let mut grants = Vec::new();

    let public_levels = sqlx::query_scalar!(
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
        &document_id_str
    )
    .fetch_all(pool)
    .await?;

    grants.extend(
        public_levels
            .into_iter()
            .map(|access_level| AccessGrant::PublicLink { access_level }),
    );

    let team_rows = sqlx::query!(
        r#"
        SELECT
            share_permission."linkShareAccessLevel" AS "access_level!: AccessLevel",
            owner_team.team_id AS "owner_team_id!"
        FROM "Document" document
        JOIN "DocumentPermission" document_permission
          ON document_permission."documentId" = document.id
        JOIN "SharePermission" share_permission
          ON share_permission.id = document_permission."sharePermissionId"
        JOIN owner_team(document.owner) owner_team
          ON EXISTS (SELECT FROM entity_access_source_matches(owner_team.team_id::text, $2, NULL))
        WHERE document.id = $1
          AND share_permission."linkShare" = 'TEAM'
          AND share_permission."linkShareAccessLevel" IS NOT NULL
        "#,
        &document_id_str,
        user_id.as_ref(),
    )
    .fetch_all(pool)
    .await?;

    grants.extend(team_rows.into_iter().map(|row| AccessGrant::TeamLink {
        access_level: row.access_level,
        owner_team_id: row.owner_team_id,
    }));

    Ok(grants)
}

#[cfg(feature = "explain_binary")]
async fn explain_document_email_attachments(
    pool: &PgPool,
    document_id: &uuid::Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let user_id_str = user_id.as_ref();
    let rows = sqlx::query!(
        r#"
        SELECT
            t.id AS thread_id,
            CASE
                WHEN l.macro_id = $2 THEN 'inbox_owner'
                WHEN EXISTS (
                    SELECT 1
                    FROM macro_user_links mul
                    WHERE mul.link_id = l.id
                      AND mul.primary_macro_id = $2
                ) THEN 'inbox_delegate'
                ELSE 'thread_grant'
            END AS "reason!"
        FROM document_email de
        JOIN email_attachments ea ON ea.id = de.email_attachment_id
        JOIN email_messages em ON em.id = ea.message_id
        JOIN email_threads t ON t.id = em.thread_id
        JOIN email_links l ON l.id = t.link_id
        WHERE de.document_id = $1
          AND (
              l.macro_id = $2
              OR EXISTS (
                  SELECT 1
                  FROM macro_user_links mul
                  WHERE mul.link_id = l.id
                    AND mul.primary_macro_id = $2
              )
              OR EXISTS (
                  SELECT 1
                  FROM entity_access thread_access
                  WHERE thread_access.entity_id = t.id
                    AND thread_access.entity_type = 'email_thread'
                    AND EXISTS (SELECT FROM entity_access_source_matches(thread_access.source_id, $2, NULL))
              )
          )
        "#,
        &document_id.to_string(),
        user_id_str,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            AccessGrant::email_attachment_reason(&row.reason).map(|reason| {
                AccessGrant::EmailAttachmentThread {
                    thread_id: row.thread_id,
                    reason,
                }
            })
        })
        .collect())
}

/// Historical document ids are not UUIDs and cannot occur in `entity_access`
/// rows. Their ownership, link grants, channel grants, and project grants still
/// live in the ordinary document and share tables.
///
/// Only users reach this path (a bot's checks need a UUID), so `$2` is both
/// the owner to compare and the viewer whose sources the grants match.
#[tracing::instrument(err, skip(pool, user_id))]
pub(crate) async fn get_legacy_document_access(
    pool: &PgPool,
    document_id: &str,
    user_id: Option<&str>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE parent_projects AS (
            SELECT p.id, p."parentId", p."userId"
            FROM "Project" p
            JOIN "Document" d ON d."projectId" = p.id
            WHERE d.id = $1 AND d."deletedAt" IS NULL AND p."deletedAt" IS NULL
            UNION
            SELECT p.id, p."parentId", p."userId"
            FROM "Project" p
            JOIN parent_projects child ON p.id = child."parentId"
            WHERE p."deletedAt" IS NULL
        ), document_permissions AS (
            SELECT d.owner, sp.id, sp."linkShare", sp."linkShareAccessLevel"
            FROM "Document" d
            LEFT JOIN "DocumentPermission" dp ON dp."documentId" = d.id
            LEFT JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
            WHERE d.id = $1 AND d."deletedAt" IS NULL
        )
        SELECT 'owner'::text AS "level!" FROM document_permissions WHERE owner = $2
        UNION ALL
        SELECT "linkShareAccessLevel"::text FROM document_permissions p
        WHERE "linkShareAccessLevel" IS NOT NULL
          AND (
              "linkShare" = 'PUBLIC'
              OR (
                  "linkShare" = 'TEAM'
                  AND EXISTS (
                      SELECT 1 FROM owner_team(p.owner) t
                      WHERE EXISTS (SELECT FROM entity_access_source_matches(t.team_id::text, $2, NULL))
                  )
              )
          )
        UNION ALL
        SELECT c.access_level::text FROM document_permissions p
        JOIN "ChannelSharePermission" c ON c.share_permission_id = p.id
        WHERE EXISTS (SELECT FROM entity_access_source_matches(c.channel_id, $2, NULL))
        UNION ALL
        SELECT 'edit'::text FROM parent_projects WHERE "userId" = $2
        UNION ALL
        SELECT a.access_level::text FROM entity_access a
        JOIN parent_projects p ON a.entity_id::text = p.id
        WHERE a.entity_type = 'project'
          AND EXISTS (SELECT FROM entity_access_source_matches(a.source_id, $2, NULL))
        "#,
        document_id,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(levels
        .iter()
        .filter_map(|level| AccessLevel::from_str(level).ok())
        .max())
}
