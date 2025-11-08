use std::collections::HashSet;

/// Removes the given user from the user_mute_notification table
#[tracing::instrument(skip(db))]
pub async fn remove_user_mute_notification(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM user_mute_notification WHERE user_id = $1
        "#,
        user_id
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Upserts the given user into the user_mute_notification table
#[tracing::instrument(skip(db))]
pub async fn upsert_user_mute_notification(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO user_mute_notification (user_id) VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        "#,
        user_id
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Given a list of user ids this will return all user ids that are muted
#[tracing::instrument(skip(db))]
pub async fn get_user_mute_notification_bulk(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_ids: &[String],
) -> anyhow::Result<HashSet<String>> {
    let muted_users = sqlx::query!(
        r#"
        SELECT user_id FROM user_mute_notification
        WHERE user_id = ANY($1)
        "#,
        user_ids
    )
    .map(|row| row.user_id)
    .fetch_all(db)
    .await?;

    Ok(muted_users.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn test_upsert_user_mute_notification(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        upsert_user_mute_notification(&pool, "A").await?;

        let result = sqlx::query!(
            r#"
            SELECT user_id FROM user_mute_notification WHERE user_id = 'A'
            "#,
        )
        .fetch_optional(&pool)
        .await?;

        assert!(result.is_some());

        Ok(())
    }

    #[sqlx::test]
    async fn test_get_user_mute_notification_bulk(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        upsert_user_mute_notification(&pool, "A").await?;
        upsert_user_mute_notification(&pool, "B").await?;
        upsert_user_mute_notification(&pool, "C").await?;

        let result = get_user_mute_notification_bulk(
            &pool,
            &["A".to_string(), "B".to_string(), "D".to_string()],
        )
        .await?;

        assert_eq!(result.len(), 2);

        Ok(())
    }
}
