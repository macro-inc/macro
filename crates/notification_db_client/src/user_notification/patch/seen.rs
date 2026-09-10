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
        SET state = CASE WHEN state = 'unseen' THEN 'seen'::notification_state ELSE state END,
            seen_at = COALESCE(seen_at, NOW())
        WHERE notification_id = $1 AND user_id = $2 AND deleted_at IS NULL
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
        UPDATE user_notification un
        SET state = CASE WHEN state = 'unseen' THEN 'seen'::notification_state ELSE state END,
            seen_at = COALESCE(seen_at, NOW())
        WHERE un.user_id = $1
        AND un.notification_id = ANY($2)
        AND un.deleted_at IS NULL
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
