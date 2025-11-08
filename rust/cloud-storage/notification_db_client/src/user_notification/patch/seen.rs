use sqlx::types::Uuid;

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
    notification_ids: &Vec<String>,
) -> anyhow::Result<()> {
    let notification_uuids = notification_ids
        .iter()
        .map(|id| macro_uuid::string_to_uuid(id))
        .collect::<Result<Vec<Uuid>, _>>()?;
    sqlx::query!(
        r#"
        UPDATE user_notification un SET seen_at = NOW()
        WHERE un.user_id = $1
        AND un.notification_id = ANY($2)
        "#,
        user_id,
        &notification_uuids,
    )
    .execute(db)
    .await?;

    Ok(())
}

/// Marks the user's notification as seen by event item id.
#[tracing::instrument(skip(db))]
pub async fn bulk_patch_seen_by_event(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    event_item_id: &str,
) -> anyhow::Result<Vec<Uuid>> {
    let result = sqlx::query!(
        r#"
        UPDATE user_notification un
            SET seen_at = NOW()
        FROM notification n
        WHERE n.id = un.notification_id
            AND n.event_item_id = $2
            AND un.user_id = $1
            AND un.seen_at IS NULL
        RETURNING un.notification_id;
        "#,
        user_id,
        event_item_id,
    )
    .map(|row| row.notification_id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};
    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]

    async fn test_patch_seen(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let notification_id = "0193b1ea-a542-7589-893b-2b4a509c1e76";
        let user_id = "macro|user@user.com";

        patch_seen(&pool, notification_id, user_id).await?;

        let notification = sqlx::query!(
            r#"
            SELECT seen_at as "seen_at?" FROM user_notification WHERE notification_id = $1 AND user_id = $2
            "#,
            macro_uuid::string_to_uuid(notification_id)?,
            user_id,
        )
        .fetch_one(&pool)
        .await?;

        assert!(notification.seen_at.is_some());

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
    async fn test_bulk_patch_seen(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|user@user.com";
        let notification_ids = vec![
            "0193b1ea-a542-7589-893b-2b4a509c1e76".to_string(),
            "0193b1ea-a542-7589-893b-2b4a509c1e75".to_string(),
        ];

        // Before patching, verify that these notifications are not marked as seen.
        for notif_id in &notification_ids {
            let rec = sqlx::query!(
                r#"
            SELECT seen_at as "seen_at?" FROM user_notification
            WHERE user_id = $1 AND notification_id = $2
            "#,
                user_id,
                macro_uuid::string_to_uuid(notif_id)?
            )
            .fetch_one(&pool)
            .await?;
            assert!(
                rec.seen_at.is_none(),
                "Notification {} is already marked as seen",
                notif_id
            );
        }

        // Perform bulk patch: mark the notifications as seen.
        bulk_patch_seen(&pool, user_id, &notification_ids).await?;

        // Verify that the notifications are now marked as seen.
        for notif_id in &notification_ids {
            let rec = sqlx::query!(
                r#"
            SELECT seen_at as "seen_at?" FROM user_notification
            WHERE user_id = $1 AND notification_id = $2
            "#,
                user_id,
                macro_uuid::string_to_uuid(notif_id)?
            )
            .fetch_one(&pool)
            .await?;
            assert!(
                rec.seen_at.is_some(),
                "Notification {} was not marked as seen",
                notif_id
            );
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
    async fn test_bulk_patch_seen_by_event(pool: Pool<Postgres>) -> anyhow::Result<()> {
        bulk_patch_seen_by_event(&pool, "macro|user@user.com", "test").await?;

        Ok(())
    }
}
