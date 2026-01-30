/// mark the user's notification as seen.
#[tracing::instrument(skip(db))]
pub async fn patch_seen(
    db: &sqlx::Pool<sqlx::Postgres>,
    notification_id: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_notification
        SET seen_at = NOW()
        WHERE notification_id = $1 AND user_id = $2
        "#,
        macro_uuid::string_to_uuid(notification_id)?,
        user_id,
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Marks the user's notifications as seen.
#[tracing::instrument(skip(db))]
pub async fn bulk_patch_seen(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    notification_ids: &Vec<uuid::Uuid>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_notification un SET seen_at = NOW()
        WHERE un.user_id = $1
        AND un.notification_id = ANY($2)
        "#,
        user_id,
        notification_ids,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod test;
