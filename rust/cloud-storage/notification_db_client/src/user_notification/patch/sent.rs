use sqlx::types::Uuid;

/// Marks the user's notification as sent.
#[tracing::instrument(skip(db))]
pub async fn bulk_patch_sent(
    db: &sqlx::Pool<sqlx::Postgres>,
    notification_id: Uuid,
    user_ids: &Vec<String>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_notification
        SET sent = true
        WHERE notification_id = $1 AND user_id = ANY($2)
        "#,
        notification_id,
        user_ids,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(db))]
pub async fn bulk_patch_sent_notification_event_item_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    notification_event_item_ids: &[String],
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_notification
        SET sent = true
        FROM notification n
        WHERE n.id = user_notification.notification_id
        AND n.event_item_id = ANY($2)
        AND user_notification.user_id = $1
        "#,
        user_id,
        notification_event_item_ids,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
    async fn test_bulk_patch_sent(pool: Pool<Postgres>) -> anyhow::Result<()> {
        bulk_patch_sent(
            &pool,
            "0193b1ea-a542-7589-893b-2b4a509c1e76".parse().unwrap(),
            &vec![
                "macro|user2@user.com".to_string(),
                "macro|user3@user.com".to_string(),
            ],
        )
        .await?;

        Ok(())
    }
}
