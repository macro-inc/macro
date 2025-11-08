use model_notifications::RawNotification;
use sqlx::{Postgres, Transaction};

/// Takes a notification that does not have a created_at timestamp and inserts it into the database
/// Returns the saved notification with a created_at timestamp
#[tracing::instrument(skip(pool, notification), fields(notification_id=%notification.id))]
pub async fn create_notification(
    pool: sqlx::Pool<sqlx::Postgres>,
    notification: RawNotification,
) -> anyhow::Result<RawNotification> {
    let created_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar!(
        r#"
        INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING created_at::timestamptz
        "#,
        &notification.id,
        notification.notification_event_type.to_string(),
        notification.event_item_id,
        notification.event_item_type,
        notification.service_sender,
        notification.metadata,
        notification.sender_id,
    )
    .fetch_one(&pool)
    .await?;

    Ok(RawNotification {
        id: notification.id,
        notification_event_type: notification.notification_event_type,
        event_item_id: notification.event_item_id,
        event_item_type: notification.event_item_type,
        service_sender: notification.service_sender,
        created_at,
        metadata: notification.metadata,
        sender_id: notification.sender_id,
    })
}

/// Takes a notification that does not have a created_at timestamp and inserts it into the database
/// Returns the saved notification with a created_at timestamp
/// This is transactional and does not commit the transaction
#[tracing::instrument(skip(transaction, notification), fields(notification_id=%notification.id))]
pub async fn create_notification_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    notification: RawNotification,
) -> anyhow::Result<RawNotification> {
    let created_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar!(
        r#"
        INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING created_at::timestamptz
        "#,
        &notification.id,
        notification.notification_event_type.to_string(),
        notification.event_item_id,
        notification.event_item_type,
        notification.service_sender,
        notification.metadata,
        notification.sender_id,
    )
    .fetch_one( transaction.as_mut())
    .await?;

    Ok(RawNotification {
        id: notification.id,
        notification_event_type: notification.notification_event_type,
        event_item_id: notification.event_item_id,
        event_item_type: notification.event_item_type,
        service_sender: notification.service_sender,
        created_at,
        metadata: notification.metadata,
        sender_id: notification.sender_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use model_notifications::NotificationEventType;
    use sqlx::{Pool, Postgres};

    #[sqlx::test]
    async fn test_create_notification(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let uuid = macro_uuid::generate_uuid_v7();
        let notification = RawNotification {
            id: uuid,
            notification_event_type: NotificationEventType::ChannelInvite.to_string(),
            event_item_id: "test".to_string(),
            event_item_type: "test".to_string(),
            service_sender: "test".to_string(),
            created_at: None,
            metadata: None,
            sender_id: None,
        };

        let result = create_notification(pool, notification).await?;

        assert!(result.created_at.is_some());

        Ok(())
    }

    #[sqlx::test]
    async fn test_create_notification_transaction(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let uuid = macro_uuid::generate_uuid_v7();
        let notification = RawNotification {
            id: uuid,
            notification_event_type: NotificationEventType::ChannelInvite.to_string(),
            event_item_id: "test".to_string(),
            event_item_type: "test".to_string(),
            service_sender: "test".to_string(),
            created_at: None,
            metadata: None,
            sender_id: None,
        };

        let mut transaction = pool.begin().await?;

        create_notification_transaction(&mut transaction, notification).await?;

        let notification = sqlx::query!("SELECT id FROM notification WHERE id = $1", uuid)
            .fetch_optional(&pool)
            .await?;

        assert!(notification.is_none());

        transaction.commit().await?;

        let notification = sqlx::query!("SELECT id FROM notification WHERE id = $1", uuid)
            .fetch_optional(&pool)
            .await?;

        assert!(notification.is_some());

        Ok(())
    }
}
