/// Gets all user_ids that are unsubscribed from the given item
#[tracing::instrument(skip(db))]
pub async fn get_unsubscribed_item_users(
    db: &sqlx::Pool<sqlx::Postgres>,
    item_id: &str,
) -> anyhow::Result<Vec<String>> {
    let result: Vec<String> = sqlx::query!(
        r#"
        SELECT u.user_id
        FROM user_notification_item_unsubscribe u
        WHERE u.item_id = $1
        "#,
        item_id
    )
    .map(|row| row.user_id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Upserts the given user into the user_notification_item_unsubscribe table
#[tracing::instrument(skip(db))]
pub async fn upsert_unsubscribed_item_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO user_notification_item_unsubscribe (user_id, item_id, item_type)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, item_id) DO NOTHING
        "#,
        user_id,
        item_id,
        item_type
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Removes the given user from the user_notification_item_unsubscribe table
#[tracing::instrument(skip(db))]
pub async fn remove_unsubscribed_item_user(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    item_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM user_notification_item_unsubscribe
        WHERE user_id = $1 AND item_id = $2
        "#,
        user_id,
        item_id,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_unsubscribed_item")))]
    async fn test_get_unsubscribed_item_users(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let result = get_unsubscribed_item_users(&pool, "document-one").await?;

        assert_eq!(
            result,
            vec![
                "macro|user@user.com".to_string(),
                "macro|user2@user.com".to_string()
            ]
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_unsubscribed_item")))]
    async fn test_upsert_unsubscribed_item_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        upsert_unsubscribed_item_user(&pool, "macro|user@user.com", "document-one", "document")
            .await?;

        let result = sqlx::query!(
            r#"
            SELECT user_id, item_id, item_type FROM user_notification_item_unsubscribe WHERE item_id = 'document-one' AND user_id = 'macro|user@user.com'
            "#,
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_some());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_unsubscribed_item")))]
    async fn test_remove_unsubscribed_item_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        remove_unsubscribed_item_user(&pool, "macro|user@user.com", "document-one").await?;

        let result = sqlx::query!(
            r#"
            SELECT user_id, item_id, item_type FROM user_notification_item_unsubscribe WHERE item_id = 'document-one' AND user_id = 'macro|user@user.com'
            "#,
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_none());

        Ok(())
    }
}
