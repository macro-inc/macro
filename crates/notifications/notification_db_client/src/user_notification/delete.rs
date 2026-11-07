#[tracing::instrument(skip(pool))]
pub async fn delete_all_users_notification(
    pool: &sqlx::PgPool,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM user_notification
        WHERE user_id = $1
        "#,
        user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(pool))]
pub async fn delete_user_notification(
    pool: &sqlx::PgPool,
    notification_id: &str,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_notification
        SET deleted_at = now()
        WHERE user_id = $1 AND notification_id = $2
        "#,
        user_id,
        macro_uuid::string_to_uuid(notification_id)?
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(pool))]
pub async fn bulk_delete_user_notification(
    pool: &sqlx::PgPool,
    user_id: &str,
    notification_ids: &Vec<uuid::Uuid>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_notification
        SET deleted_at = now()
        WHERE user_id = $1
        AND notification_id = ANY($2)
        "#,
        user_id,
        &notification_ids,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod test;
