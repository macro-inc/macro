use model_notifications::NotificationEventType;
use sqlx::types::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UnsentNotification {
    pub user_id: String,
    pub event_item_id: String,
    pub event_item_type: String,
    pub notification_id: Uuid,
    pub created_at: chrono::NaiveDateTime,
}

/// Gets unsent notifications for users
/// A notification is unsent if it has not been sent, seen or done
#[tracing::instrument(skip(db))]
pub async fn get_unsent_notifications_for_users(
    db: &sqlx::PgPool,
    notification_event_types: &[NotificationEventType],
    limit: i64,
    offset: i64,
    hours_ago: f64,
) -> anyhow::Result<Vec<UnsentNotification>> {
    let notification_event_types = notification_event_types
        .iter()
        .map(|notification_event_type| notification_event_type.to_string())
        .collect::<Vec<String>>();

    let result = sqlx::query!(
        r#"
        SELECT
            DISTINCT ON (un.user_id, n.event_item_id) un.user_id, n.event_item_id,
            n.created_at,
            n.event_item_type,
            n.id
        FROM user_notification un
        JOIN notification n ON un.notification_id = n.id
        WHERE un.sent = false AND un.done = false AND un.seen_at IS NULL AND n.notification_event_type = ANY($1)
        AND un.created_at > NOW() - ($4 * interval '1 hour')
        ORDER BY un.user_id, n.event_item_id, n.created_at DESC
        LIMIT $2
        OFFSET $3
        "#,
        &notification_event_types,
        limit,
        offset,
        hours_ago
    )
    .map(|row| {
        UnsentNotification {
            user_id: row.user_id,
            event_item_id: row.event_item_id,
            event_item_type: row.event_item_type,
            notification_id: row.id,
            created_at: row.created_at,
        }
    })
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    async fn populate_notifications(pool: &Pool<Postgres>) -> anyhow::Result<()> {
        let notification_event_type = NotificationEventType::ChannelMessageSend.to_string();

        let notification_event_type = notification_event_type.as_str();

        let notifications = vec![
            (
                "11111111-1111-1111-1111-111111111111",
                "item_id",
                "item_type",
                notification_event_type,
            ),
            (
                "22222222-2222-2222-2222-222222222222",
                "item_id2",
                "item_type",
                notification_event_type,
            ),
            (
                "33333333-3333-3333-3333-333333333333",
                "item_id3",
                "item_type",
                notification_event_type,
            ),
            (
                "44444444-4444-4444-4444-444444444444",
                "item_id4",
                "item_type",
                notification_event_type,
            ),
        ];

        for notification in notifications {
            sqlx::query!(
                r#"
                INSERT INTO notification (id, event_item_id, event_item_type, notification_event_type, service_sender)
                VALUES ($1, $2, $3, $4, 'test')
                "#,
                macro_uuid::string_to_uuid(&notification.0)?,
                notification.1,
                notification.2,
                notification.3,
            )
            .execute(pool)
            .await?;
        }

        let user_notifications = vec![
            (
                "user_id",                              // user_id
                "11111111-1111-1111-1111-111111111111", // notification_id
                false,                                  // sent
                false,                                  // done
                None,                                   // seen_at
            ),
            (
                "user_id2",
                "22222222-2222-2222-2222-222222222222",
                false,
                false,
                Some(chrono::NaiveDateTime::from_timestamp(0, 0)),
            ),
            (
                "user_id3",
                "33333333-3333-3333-3333-333333333333",
                false,
                true,
                None,
            ),
            (
                "user_id4",
                "44444444-4444-4444-4444-444444444444",
                true,
                false,
                None,
            ),
        ];

        for user_notification in user_notifications {
            sqlx::query!(
                r#"
                INSERT INTO user_notification (user_id, notification_id, sent, done, seen_at)
                VALUES ($1, $2, $3, $4, $5)
                "#,
                user_notification.0,
                macro_uuid::string_to_uuid(&user_notification.1)?,
                user_notification.2,
                user_notification.3,
                user_notification.4,
            )
            .execute(pool)
            .await?;
        }

        Ok(())
    }

    #[sqlx::test]
    async fn test_get_unsent_notifications_for_users(pool: Pool<Postgres>) -> anyhow::Result<()> {
        populate_notifications(&pool).await?;

        let hours_ago = 1.0;
        let limit = 100;
        let offset = 0;

        let unsent_notifications = get_unsent_notifications_for_users(
            &pool,
            &[NotificationEventType::ChannelMessageSend],
            limit,
            offset,
            hours_ago,
        )
        .await?;

        assert_eq!(unsent_notifications.len(), 1);

        assert_eq!(
            unsent_notifications[0].notification_id,
            "11111111-1111-1111-1111-111111111111".parse::<Uuid>()?
        );

        sqlx::query!(
            r#"
            UPDATE user_notification
            SET created_at = NOW() - INTERVAL '2 hours'
            WHERE notification_id = $1
            "#,
            &unsent_notifications[0].notification_id
        )
        .execute(&pool)
        .await?;

        let unsent_notifications = get_unsent_notifications_for_users(
            &pool,
            &[NotificationEventType::ChannelMessageSend],
            limit,
            offset,
            hours_ago,
        )
        .await?;

        assert_eq!(unsent_notifications.len(), 0);

        Ok(())
    }
}
