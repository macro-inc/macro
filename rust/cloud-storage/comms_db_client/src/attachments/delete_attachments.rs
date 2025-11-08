use anyhow::Context;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(db))]
pub async fn delete_attachments_by_ids(
    db: &Pool<Postgres>,
    attachment_ids: Vec<Uuid>,
) -> anyhow::Result<u64> {
    if attachment_ids.is_empty() {
        return Ok(0);
    }

    let deleted_count = sqlx::query!(
        r#"
        DELETE FROM comms_attachments
        WHERE id = ANY($1)
        "#,
        &attachment_ids
    )
    .execute(db)
    .await
    .context("failed to delete attachments by IDs")?
    .rows_affected();

    // Log deletion information
    tracing::debug!(
        attachment_ids=?attachment_ids,
        count=%deleted_count,
        "Deleted attachments by IDs"
    );

    Ok(deleted_count)
}
