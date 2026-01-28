//! Database repository adapter for notifications.

use std::collections::{HashMap, HashSet};

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{DeviceEndpoint, Notification, SendNotificationRequestBuilder};
use crate::domain::ports::NotificationRepository;

/// Database-backed implementation of the notification repository port.
///
/// This adapter handles all database operations for notifications including
/// creating notifications, checking user preferences, and managing device endpoints.
pub struct DbNotificationRepository<D> {
    db: D,
}

impl<D> DbNotificationRepository<D> {
    /// Create a new database notification repository.
    pub fn new(db: D) -> Self {
        Self { db }
    }
}

/// Trait for database operations needed by the notification repository.
///
/// This allows the adapter to work with different database client implementations.
pub trait NotificationDbOps {
    /// Get users who have muted all notifications.
    fn get_muted_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl std::future::Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;

    /// Get users who have unsubscribed from notifications for a specific item.
    fn get_unsubscribed_users<'a>(
        &self,
        item_id: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl std::future::Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;

    /// Get device endpoints for the given users.
    fn get_device_endpoints<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl std::future::Future<
        Output = Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report>,
    > + Send;

    /// Create a notification record in the database.
    ///
    /// Returns `Some(notification_id)` if created, `None` if it already exists (idempotent).
    fn create_notification<'a, T: Notification + Send + Sync>(
        &self,
        request: &SendNotificationRequestBuilder<'a, T>,
        notification_id: Uuid,
        service_name: &str,
        recipient_ids: &[MacroUserIdStr<'a>],
    ) -> impl std::future::Future<Output = Result<Option<Uuid>, Report>> + Send;

    /// Update the sent status for recipients who received the notification.
    fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl NotificationDbOps for PgPool {
    async fn get_muted_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();

        let muted_users: Vec<String> = sqlx::query_scalar(
            r#"
            SELECT user_id FROM user_mute_notification
            WHERE user_id = ANY($1)
            "#,
        )
        .bind(&ids)
        .fetch_all(self)
        .await?;

        let result = muted_users
            .into_iter()
            .filter_map(|id| {
                MacroUserIdStr::parse_from_str(&id)
                    .map(CowLike::into_owned)
                    .ok()
            })
            .map(|id| id.into_owned())
            .collect();

        Ok(result)
    }

    async fn get_unsubscribed_users<'a>(
        &self,
        item_id: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();

        let unsubscribed: Vec<String> = sqlx::query_scalar(
            r#"
            SELECT user_id FROM user_notification_item_unsubscribe
            WHERE item_id = $1 AND user_id = ANY($2)
            "#,
        )
        .bind(item_id)
        .bind(&ids)
        .fetch_all(self)
        .await?;

        let result = unsubscribed
            .into_iter()
            .filter_map(|id| {
                MacroUserIdStr::parse_from_str(&id)
                    .map(CowLike::into_owned)
                    .ok()
            })
            .map(|id| id.into_owned())
            .collect();

        Ok(result)
    }

    async fn get_device_endpoints<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();

        let rows: Vec<(String, String, String)> = sqlx::query_as(
            r#"
            SELECT user_id, device_endpoint, device_type
            FROM user_device_registration
            WHERE user_id = ANY($1)
            "#,
        )
        .bind(&ids)
        .fetch_all(self)
        .await?;

        let mut result: HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>> = HashMap::new();

        for (user_id, endpoint, device_type) in rows {
            let Ok(parsed_id) = MacroUserIdStr::parse_from_str(&user_id) else {
                continue;
            };

            let device = match device_type.as_str() {
                "ios" => DeviceEndpoint::Ios(endpoint),
                "android" => DeviceEndpoint::Android(endpoint),
                _ => continue,
            };

            result
                .entry(parsed_id.into_owned())
                .or_default()
                .push(device);
        }

        Ok(result)
    }

    async fn create_notification<'a, T: Notification + Send + Sync>(
        &self,
        request: &SendNotificationRequestBuilder<'a, T>,
        notification_id: Uuid,
        service_name: &str,
        recipient_ids: &[MacroUserIdStr<'a>],
    ) -> Result<Option<Uuid>, Report> {
        let entity_type: &str = request.notification_entity.entity_type.into();
        let metadata = serde_json::to_value(&request.notification).ok();

        let mut tx = self.begin().await?;

        // Insert notification
        sqlx::query(
            r#"
            INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(notification_id)
        .bind(T::TYPE_NAME)
        .bind(request.notification_entity.entity_id.as_ref())
        .bind(entity_type)
        .bind(service_name)
        .bind(&metadata)
        .bind(request.sender_id.as_ref().map(|id| id.to_string()))
        .execute(&mut *tx)
        .await?;

        // Insert user notifications
        let user_ids: Vec<String> = recipient_ids.iter().map(|id| id.to_string()).collect();

        sqlx::query(
            r#"
            INSERT INTO user_notification (notification_id, user_id)
            SELECT $1, user_id
            FROM UNNEST($2::text[]) as user_id
            "#,
        )
        .bind(notification_id)
        .bind(&user_ids)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(Some(notification_id))
    }

    async fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();

        sqlx::query(
            r#"
            UPDATE user_notification
            SET sent = true
            WHERE notification_id = $1 AND user_id = ANY($2)
            "#,
        )
        .bind(notification_id)
        .bind(&ids)
        .execute(self)
        .await?;

        Ok(())
    }
}

impl<D: NotificationDbOps + Send + Sync> NotificationRepository for DbNotificationRepository<D> {
    async fn get_muted_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.db.get_muted_users(user_ids).await
    }

    async fn get_unsubscribed_users<'a>(
        &self,
        item_id: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.db.get_unsubscribed_users(item_id, user_ids).await
    }

    async fn get_device_endpoints<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        self.db.get_device_endpoints(user_ids).await
    }

    async fn create_notification<'a, T: Notification + Send + Sync>(
        &self,
        request: &SendNotificationRequestBuilder<'a, T>,
        notification_id: Uuid,
        service_name: &str,
        recipient_ids: &[MacroUserIdStr<'a>],
    ) -> Result<Option<Uuid>, Report> {
        self.db
            .create_notification(request, notification_id, service_name, recipient_ids)
            .await
    }

    async fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        self.db.update_sent_status(notification_id, user_ids).await
    }
}
