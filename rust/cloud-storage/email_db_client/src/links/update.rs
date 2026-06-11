use sqlx::PgPool;
use sqlx::types::Uuid;

/// Re-homes a link's `fusionauth_user_id`. Used after a shared mailbox's Google grant is
/// relocated onto a dedicated FusionAuth user so token resolution follows it there.
#[tracing::instrument(skip(pool), err)]
pub async fn update_link_fusionauth_user_id(
    pool: &PgPool,
    link_id: Uuid,
    fusionauth_user_id: &str,
) -> anyhow::Result<()> {
    let result = sqlx::query!(
        r#"
        UPDATE email_links
        SET fusionauth_user_id = $2, updated_at = NOW()
        WHERE id = $1
        "#,
        link_id,
        fusionauth_user_id,
    )
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("no email_links row found for link_id {link_id}");
    }

    Ok(())
}

/// Updates the sync active status for a link by its ID.
/// Also updates the updated_at timestamp to the current time.
#[tracing::instrument(skip(pool), err)]
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
    .await?;

    Ok(())
}
