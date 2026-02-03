/// mark the user's notification as done.
#[tracing::instrument(skip(db))]
pub async fn patch_done(
    db: &sqlx::Pool<sqlx::Postgres>,
    notification_id: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_notification
        SET done = true
        WHERE notification_id = $1 AND user_id = $2
        "#,
        macro_uuid::string_to_uuid(notification_id)?,
        user_id,
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Marks the user's notifications as done or undone.
#[tracing::instrument(skip(db))]
pub async fn bulk_patch_done(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    notification_ids: &Vec<uuid::Uuid>,
    done: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_notification
        SET done = $3
        WHERE user_id = $1
        AND notification_id = ANY($2)
        "#,
        user_id,
        notification_ids,
        done
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod test;
