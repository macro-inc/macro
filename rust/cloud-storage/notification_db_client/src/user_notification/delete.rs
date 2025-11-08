use sqlx::types::Uuid;

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
    notification_ids: &Vec<String>,
) -> anyhow::Result<()> {
    let notification_uuids = notification_ids
        .iter()
        .map(|id| macro_uuid::string_to_uuid(id))
        .collect::<Result<Vec<Uuid>, _>>()?;
    sqlx::query!(
        r#"
        UPDATE user_notification
        SET deleted_at = now()
        WHERE user_id = $1
        AND notification_id = ANY($2)
        "#,
        user_id,
        &notification_uuids,
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_notifications")))]
    async fn test_delete_user_notification(pool: Pool<Postgres>) -> anyhow::Result<()> {
        delete_user_notification(
            &pool,
            "0193b1ea-a542-7589-893b-2b4a509c1e74",
            "macro|user@user.com",
        )
        .await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_notifications")))]
    async fn test_bulk_delete_user_notification(pool: Pool<Postgres>) -> anyhow::Result<()> {
        bulk_delete_user_notification(
            &pool,
            "macro|user@user.com",
            &vec![
                "0193b1ea-a542-7589-893b-2b4a509c1e76".to_string(),
                "0193b1ea-a542-7589-893b-2b4a509c1e75".to_string(),
            ],
        )
        .await?;

        Ok(())
    }
}
