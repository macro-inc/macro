use anyhow::Context;
use sqlx::PgPool;
use sqlx::types::Uuid;

/// Updates the sync active status for a link by its ID.
/// Also updates the updated_at timestamp to the current time.
#[tracing::instrument(skip(pool), level = "info")]
pub async fn update_link_sync_status(
    pool: &PgPool,
    link_id: Uuid,
    is_sync_active: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_links
        SET is_sync_active = $2, updated_at = NOW()
        WHERE id = $1
        "#,
        link_id,
        is_sync_active
    )
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to update sync status to {} for link with ID {}",
            is_sync_active, link_id
        )
    })?;

    Ok(())
}
