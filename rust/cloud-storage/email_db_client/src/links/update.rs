use sqlx::PgPool;
use sqlx::types::Uuid;

#[cfg(test)]
mod test;

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

/// Marks a link as needing reauth and records when the failure was observed.
/// Returns `true` only when this call flipped the link from healthy to
/// needs-reauth, letting callers fire a one-time notification on that edge.
/// Returns `false` when it was already flagged or no such link exists.
#[tracing::instrument(skip(pool), err)]
pub async fn set_link_needs_reauth(pool: &PgPool, link_id: Uuid) -> anyhow::Result<bool> {
    let row = sqlx::query!(
        r#"
        WITH prev AS (
            SELECT needs_reauth FROM email_links WHERE id = $1 FOR UPDATE
        )
        UPDATE email_links e
        SET needs_reauth = true,
            last_sync_error_at = NOW(),
            updated_at = NOW()
        FROM prev
        WHERE e.id = $1
        RETURNING (NOT prev.needs_reauth) AS "did_transition!"
        "#,
        link_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(matches!(row, Some(r) if r.did_transition))
}

/// Clears a link's reauth flag once its token is healthy again. A no-op when the
/// flag isn't set, so it is cheap to call on every successful token fetch.
#[tracing::instrument(skip(pool), err)]
pub async fn clear_link_needs_reauth(pool: &PgPool, link_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_links
        SET needs_reauth = false,
            last_sync_error_at = NULL,
            updated_at = NOW()
        WHERE id = $1 AND needs_reauth = true
        "#,
        link_id,
    )
    .execute(pool)
    .await?;

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
