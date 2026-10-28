//! Auto-share a link-shared document with users mentioned in its comments.
//!
//! When a user is `@mentioned` in a document comment we notify them, but being
//! notified isn't enough for the document to surface in their soup/inbox — that
//! requires an explicit `entity_access` row. For documents shared by a PUBLIC or
//! TEAM link, every mentioned user is granted the selected link-share access
//! level. Documents without link sharing are left untouched.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

#[cfg(test)]
mod test;

/// Grants mentioned users `entity_access` to a link-shared document so it
/// appears in their soup.
///
/// PUBLIC and TEAM links grant every mentioned user the document's selected
/// link-share access level; TEAM grants are intentionally not filtered by team
/// membership. Documents without link sharing and empty recipient lists are
/// no-ops. Existing access rows are never downgraded because conflicts are
/// ignored, and the owner row is left intact.
#[tracing::instrument(
    skip(db, mentioned_user_ids),
    fields(document_id = %document_id, user_count = mentioned_user_ids.len()),
    err
)]
pub async fn share_link_shared_document_with_mentioned_users(
    db: &Pool<Postgres>,
    document_id: &str,
    mentioned_user_ids: &[MacroUserIdStr<'_>],
) -> anyhow::Result<()> {
    if mentioned_user_ids.is_empty() {
        return Ok(());
    }

    let user_ids: Vec<String> = mentioned_user_ids
        .iter()
        .map(|id| id.as_ref().to_string())
        .collect();

    // Insert one access row per mentioned user when the document has a PUBLIC
    // or TEAM link. The query deliberately does not filter recipients by team
    // membership. `DO NOTHING` preserves pre-existing (possibly higher) access.
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT dp."documentId"::uuid, 'document', u.user_id, 'user', sp."linkShareAccessLevel"::"AccessLevel"
        FROM "DocumentPermission" dp
        JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
        CROSS JOIN UNNEST($2::text[]) AS u(user_id)
        WHERE dp."documentId" = $1
          AND sp."linkShare" IN ('PUBLIC', 'TEAM')
          AND sp."linkShareAccessLevel" IS NOT NULL
        ON CONFLICT (entity_id, entity_type, source_id, source_type)
        WHERE granted_from_project_id IS NULL
        DO NOTHING
        "#,
        document_id,
        user_ids.as_slice(),
    )
    .execute(db)
    .await?;

    Ok(())
}
