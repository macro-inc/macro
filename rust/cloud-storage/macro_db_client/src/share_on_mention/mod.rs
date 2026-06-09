//! Auto-share a public document with users mentioned in its comments.
//!
//! When a user is `@mentioned` in a document comment we notify them, but being
//! notified isn't enough for the document to surface in their soup/inbox — that
//! requires an explicit `entity_access` row. For **public** documents we grant
//! the mentioned users access at the document's public access level so the
//! mention is actionable from their inbox. Private documents are left untouched
//! so a mention can't silently widen access beyond what was already public.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

#[cfg(test)]
mod test;

/// Grants the mentioned users `entity_access` to the document when it is public,
/// so the document appears in their soup.
///
/// No-op when the document isn't public or no users are supplied. Existing
/// access rows are never downgraded (conflicts are ignored), and the owner row
/// is left intact.
#[tracing::instrument(
    skip(db, mentioned_user_ids),
    fields(document_id = %document_id, user_count = mentioned_user_ids.len()),
    err
)]
pub async fn share_public_document_with_mentioned_users(
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

    // Insert one access row per mentioned user, but only when the document is
    // public — the join against `SharePermission` yields no rows otherwise, so
    // the whole statement becomes a no-op for private documents. We grant the
    // same level the document is public at, and `DO NOTHING` ensures we never
    // clobber a user's pre-existing (possibly higher) access.
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT dp."documentId"::uuid, 'document', u.user_id, 'user', sp."publicAccessLevel"::"AccessLevel"
        FROM "DocumentPermission" dp
        JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
        CROSS JOIN UNNEST($2::text[]) AS u(user_id)
        WHERE dp."documentId" = $1
          AND sp."isPublic" = true
          AND sp."publicAccessLevel" IS NOT NULL
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
