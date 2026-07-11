use sqlx::PgPool;
use sqlx::types::Uuid;

#[tracing::instrument(skip(pool), err)]
pub async fn set_deleted_at(
    pool: &PgPool,
    link_id: Uuid,
    deletion_reason: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_links_history
        SET deleted_at = NOW(),
            deletion_reason = $2
        WHERE link_id = $1
          AND deleted_at IS NULL
        "#,
        link_id,
        deletion_reason,
    )
    .execute(pool)
    .await?;

    Ok(())
}
