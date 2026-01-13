use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DbBasicNotification<T> {
    pub event_item_id: String,
    pub event_item_type: String,
    pub notification_event_type: String,
    pub apns_collapse_key: T,
}

impl<T> DbBasicNotification<Option<T>> {
    pub fn transpose(self) -> Option<DbBasicNotification<T>> {
        let DbBasicNotification {
            event_item_id,
            event_item_type,
            notification_event_type,
            apns_collapse_key,
        } = self;
        match apns_collapse_key {
            Some(val) => Some(DbBasicNotification {
                event_item_id,
                event_item_type,
                notification_event_type,
                apns_collapse_key: val,
            }),
            None => None,
        }
    }
}

/// Gets a notification by id
#[tracing::instrument(err, skip(db))]
pub async fn get_basic_notification(
    db: &sqlx::PgPool,
    notification_id: &Uuid,
) -> anyhow::Result<DbBasicNotification<Option<String>>> {
    let notification = sqlx::query_as!(
        DbBasicNotification,
        r#"
        SELECT
            n.event_item_id,
            n.event_item_type,
            n.notification_event_type,
            n.apns_collapse_key
        FROM notification n
        WHERE n.id = $1
        "#,
        notification_id
    )
    .fetch_one(db)
    .await?;

    Ok(notification)
}

/// Updates the APNS collapse key for a notification and returns the updated notification
#[tracing::instrument(err, skip(db))]
pub async fn update_collapse_key(
    db: &sqlx::PgPool,
    notification_id: &Uuid,
    collapse_key: &str,
) -> anyhow::Result<DbBasicNotification<String>> {
    let notification = sqlx::query_as!(
        DbBasicNotification,
        r#"
        UPDATE notification
        SET apns_collapse_key = $2
        WHERE id = $1
        RETURNING
            event_item_id,
            event_item_type,
            notification_event_type,
            apns_collapse_key as "apns_collapse_key!"
        "#,
        notification_id,
        collapse_key
    )
    .fetch_one(db)
    .await?;

    Ok(notification)
}

pub trait BasicNotificationRepo: Send + Sync + 'static {
    fn update_collapse_key(
        &self,
        notification_id: &Uuid,
        collapse_key: &str,
    ) -> impl Future<Output = anyhow::Result<DbBasicNotification<String>>> + Send;

    fn get_basic_notification(
        &self,
        notification_id: &Uuid,
    ) -> impl Future<Output = anyhow::Result<DbBasicNotification<Option<String>>>> + Send;
}

pub struct BasicNotifRepoImpl(pub PgPool);

impl BasicNotificationRepo for BasicNotifRepoImpl {
    fn update_collapse_key(
        &self,
        notification_id: &Uuid,
        collapse_key: &str,
    ) -> impl Future<Output = anyhow::Result<DbBasicNotification<String>>> + Send {
        update_collapse_key(&self.0, notification_id, collapse_key)
    }

    fn get_basic_notification(
        &self,
        notification_id: &Uuid,
    ) -> impl Future<Output = anyhow::Result<DbBasicNotification<Option<String>>>> + Send {
        get_basic_notification(&self.0, notification_id)
    }
}
