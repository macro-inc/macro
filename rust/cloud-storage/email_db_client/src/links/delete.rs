use anyhow::Context;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Deletes a link by its ID.
/// Will cascade to delete threads, messages, attachments, and labels for the user.
/// Returns the number of rows affected (should be 1 if successful, 0 if the link didn't exist).
#[tracing::instrument(skip(pool), level = "info")]
pub async fn delete_link_by_id(pool: &PgPool, link_id: Uuid) -> anyhow::Result<u64> {
    let result = sqlx::query!(
        r#"
        DELETE FROM email_links
        WHERE id = $1
        "#,
        link_id
    )
    .execute(pool)
    .await
    .with_context(|| format!("Failed to delete link with ID {}", link_id))?;

    Ok(result.rows_affected())
}
