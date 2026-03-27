use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Query};
use notification::domain::models::TaggedContent;
use notification::domain::models::{
    DeviceEndpoint, NotificationIdAndCollapseKey, SendNotificationRequestBuilder,
    UserNotificationRow, device::DeviceType,
};
use notification::domain::ports::NotificationRepository;
use notification::outbound::repository::DbNotificationRepository;
use rootcause::Report;
use serde::Serialize;
use serde::de::DeserializeOwned;
use sqlx::PgPool;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

/// Notification repository that wraps the real DB repository but overrides
/// `get_device_endpoints` to return sandbox-configured endpoints.
///
/// This avoids needing real device registration records in the database.
pub struct SandboxNotificationRepository {
    inner: DbNotificationRepository<PgPool>,
    device_endpoints: HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>,
}

impl SandboxNotificationRepository {
    /// Create a new sandbox repository.
    pub fn new(
        inner: DbNotificationRepository<PgPool>,
        device_endpoints: HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>,
    ) -> Self {
        Self {
            inner,
            device_endpoints,
        }
    }
}

impl NotificationRepository for SandboxNotificationRepository {
    async fn get_muted_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.inner.get_muted_users(user_ids).await
    }

    async fn get_unsubscribed_users<'a>(
        &self,
        item_id: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.inner.get_unsubscribed_users(item_id, user_ids).await
    }

    async fn create_notification<'a, T: Serialize + Send + Sync>(
        &self,
        request: SendNotificationRequestBuilder<'a, TaggedContent<T>>,
        notification_id: Uuid,
        service_sender: &str,
        apns_collapse_key: Option<&str>,
    ) -> Result<Option<Vec<UserNotificationRow<Arc<T>>>>, Report> {
        self.inner
            .create_notification(request, notification_id, service_sender, apns_collapse_key)
            .await
    }

    async fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        self.inner
            .update_sent_status(notification_id, user_ids)
            .await
    }

    async fn get_device_endpoints<'a>(
        &self,
        _user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>>, Report> {
        // Return sandbox-configured endpoints instead of querying DB.
        Ok(self.device_endpoints.clone())
    }

    async fn mark_notifications_seen(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        self.inner
            .mark_notifications_seen(user_id, notification_ids)
            .await
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<(), Report> {
        self.inner
            .mark_notifications_done(user_id, notification_ids, done)
            .await
    }

    async fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> Result<Vec<NotificationIdAndCollapseKey>, Report> {
        self.inner.get_basic_notifications(notification_ids).await
    }

    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        self.inner
            .get_user_notifications(user_id, limit, cursor)
            .await
    }

    async fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        event_item_ids: &[Uuid],
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        self.inner
            .get_user_notifications_by_event_item_ids(user_id, event_item_ids, limit, cursor)
            .await
    }

    async fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<Option<UserNotificationRow<T>>, Report> {
        self.inner
            .get_user_notification_by_id(user_id, notification_id)
            .await
    }

    async fn delete_user_notification(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<(), Report> {
        self.inner
            .delete_user_notification(user_id, notification_id)
            .await
    }

    async fn bulk_delete_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        self.inner
            .bulk_delete_user_notifications(user_id, notification_ids)
            .await
    }

    async fn delete_all_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        self.inner.delete_all_user_notifications(user_id).await
    }

    async fn get_device_endpoint(&self, device_token: &str) -> Result<Option<String>, Report> {
        self.inner.get_device_endpoint(device_token).await
    }

    async fn upsert_device(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_endpoint: &str,
        device_type: &DeviceType,
    ) -> Result<(), Report> {
        self.inner
            .upsert_device(user_id, device_token, device_endpoint, device_type)
            .await
    }

    async fn delete_device_by_token(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<String, Report> {
        self.inner
            .delete_device_by_token(device_token, device_type)
            .await
    }

    async fn delete_device_by_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.inner.delete_device_by_endpoint(endpoint_arn).await
    }

    async fn get_users_with_type_disabled<'a>(
        &self,
        notification_event_type: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.inner
            .get_users_with_type_disabled(notification_event_type, user_ids)
            .await
    }

    async fn get_disabled_notification_types(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<notification::domain::models::DisabledNotificationType>, Report> {
        self.inner.get_disabled_notification_types(user_id).await
    }

    async fn disable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> Result<(), Report> {
        self.inner
            .disable_notification_type(user_id, notification_event_type)
            .await
    }

    async fn enable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> Result<(), Report> {
        self.inner
            .enable_notification_type(user_id, notification_event_type)
            .await
    }
}
