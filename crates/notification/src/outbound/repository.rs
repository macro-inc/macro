//! Database repository adapter for notifications.

#[cfg(test)]
mod test;

use crate::domain::models::delivery_outbox::{
    ClaimedDeliveryIntent, ClaimedDeliveryRequest, ClaimedDigestReceiptCleanup, DeliveryClaimToken,
    DeliveryLease,
};
use crate::domain::models::device::DeviceType;
use crate::domain::models::request::{NotificationCategory, NotificationListFilters};
use crate::domain::models::{
    DeviceEndpoint, DisabledNotificationType, NotificationIdAndCollapseKey,
    SendNotificationRequest, SendNotificationRequestBuilder, TaggedContent, UserNotificationRow,
};
use crate::domain::ports::{NotificationDeliveryRepository, NotificationRepository};
use crate::outbound::device_registration::DeviceRegistrationDbOps;
use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use models_pagination::{CreatedAt, Query};
use notification_state::NotificationState;
use rootcause::Report;
use serde::Serialize;
use serde::de::DeserializeOwned;
use sqlx::{PgPool, Postgres, QueryBuilder};
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use std::sync::Arc;
use uuid::Uuid;

type UserNotificationListRow = (
    String,
    Uuid,
    String,
    String,
    bool,
    NotificationState,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    serde_json::Value,
    String,
    Option<String>,
);

#[derive(sqlx::FromRow)]
struct EntityNotificationListRow {
    owner_id: String,
    notification_id: Uuid,
    event_item_id: String,
    event_item_type: String,
    secondary_event_item_id: Option<String>,
    secondary_event_item_type: Option<String>,
    sent: bool,
    state: NotificationState,
    created_at: DateTime<Utc>,
    viewed_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
    notification_metadata: serde_json::Value,
    notification_event_type: String,
    sender_id: Option<String>,
}

struct UpdatedUserNotificationRow {
    owner_id: String,
    notification_id: Uuid,
    event_item_id: String,
    event_item_type: String,
    sent: bool,
    state: NotificationState,
    created_at: DateTime<Utc>,
    viewed_at: Option<DateTime<Utc>>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
    notification_metadata: serde_json::Value,
    notification_event_type: String,
    sender_id: Option<String>,
}

impl UpdatedUserNotificationRow {
    fn into_domain(self) -> Result<UserNotificationRow<serde_json::Value>, Report> {
        let entity = EntityType::from_str(&self.event_item_type)
            .map_err(|error| rootcause::report!(error))?
            .with_entity_string(self.event_item_id);
        let sender_id = self
            .sender_id
            .as_deref()
            .map(|sender| MacroUserIdStr::parse_from_str(sender).map(CowLike::into_owned))
            .transpose()
            .map_err(|error| rootcause::report!(error))?;
        let owner_id = MacroUserIdStr::parse_from_str(&self.owner_id)
            .map(CowLike::into_owned)
            .map_err(|error| rootcause::report!(error))?;

        Ok(UserNotificationRow {
            owner_id,
            notification_id: self.notification_id,
            notification_event_type: self.notification_event_type,
            entity,
            sent: self.sent,
            state: self.state,
            created_at: self.created_at,
            viewed_at: self.viewed_at,
            updated_at: self.updated_at,
            deleted_at: self.deleted_at,
            notification_metadata: self.notification_metadata,
            sender_id,
        })
    }
}

struct UserNotificationsQueryArgs<'a> {
    user_id: &'a str,
    event_item_ids: Option<&'a [String]>,
    limit: i64,
    cursor_id: Option<Uuid>,
    cursor_timestamp: Option<DateTime<Utc>>,
    filters: &'a NotificationListFilters,
}

fn build_user_notifications_query<'a>(
    args: UserNotificationsQueryArgs<'a>,
) -> QueryBuilder<'a, Postgres> {
    let UserNotificationsQueryArgs {
        user_id,
        event_item_ids,
        limit,
        cursor_id,
        cursor_timestamp,
        filters,
    } = args;

    let mut builder = QueryBuilder::new(
        r#"
            SELECT
                un.user_id as owner_id,
                un.notification_id,
                n.event_item_id,
                n.event_item_type,
                un.sent,
                un.state,
                un.created_at::timestamptz as created_at,
                un.seen_at::timestamptz as viewed_at,
                un.created_at::timestamptz as updated_at,
                un.deleted_at::timestamptz as deleted_at,
                n.metadata as notification_metadata,
                n.notification_event_type as notification_event_type,
                n.sender_id as sender_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.user_id = "#,
    );
    builder.push_bind(user_id);

    push_event_item_ids_filter(&mut builder, event_item_ids);
    push_notification_status_filters(&mut builder, filters);
    push_include_types_filter(&mut builder, &filters.include_types);
    push_entities_filter(&mut builder, &filters.entities);
    push_cursor_filter(&mut builder, cursor_timestamp, cursor_id);

    builder.push(" ORDER BY un.created_at DESC, un.notification_id DESC LIMIT ");
    builder.push_bind(limit);

    builder
}

fn push_event_item_ids_filter<'a>(
    builder: &mut QueryBuilder<'a, Postgres>,
    event_item_ids: Option<&'a [String]>,
) {
    if let Some(event_item_ids) = event_item_ids {
        builder.push(" AND n.event_item_id = ANY(");
        builder.push_bind(event_item_ids);
        builder.push(")");
    }
}

fn push_notification_status_filters(
    builder: &mut QueryBuilder<'_, Postgres>,
    filters: &NotificationListFilters,
) {
    builder.push(" AND un.deleted_at IS NULL");

    if !filters.states.is_empty() {
        builder.push(" AND un.state = ANY(");
        builder.push_bind(filters.states.clone());
        builder.push(")");
    }
}

/// SQL fragment matching every GitHub notification event type. Keep in sync with
/// the `Notification::TYPE_NAME`s of the GitHub metadata types in `model_notifications`
/// (this crate sits below `model_notifications`, so it cannot reference them directly).
const GITHUB_EVENT_TYPES_SQL: &str = concat!(
    "n.notification_event_type IN (",
    "'github_pr_status_changed', ",
    "'github_review_requested', ",
    "'github_pr_comment', ",
    "'github_pr_mention', ",
    "'github_pr_review', ",
    "'github_pr_check_run'",
    ")",
);

fn push_include_types_filter(
    builder: &mut QueryBuilder<'_, Postgres>,
    include_types: &[NotificationCategory],
) {
    if !include_types.is_empty() {
        builder.push(" AND (");
        let mut needs_or = false;
        for clause in [
            include_types.contains(&NotificationCategory::Email)
                .then_some("n.event_item_type = 'email_thread'"),
            include_types.contains(&NotificationCategory::Message).then_some(
                r#"(
                    n.notification_event_type IN ('channel_mention', 'channel_message_reply', 'channel_message_send')
                    OR n.metadata ? 'messageId'
                    OR n.metadata ? 'message_id'
                )"#,
            ),
            include_types.contains(&NotificationCategory::Channel)
                .then_some("n.event_item_type = 'channel'"),
            include_types.contains(&NotificationCategory::Document).then_some(
                "n.event_item_type = 'document' AND COALESCE(n.metadata->>'subType', n.metadata->>'sub_type', '') <> 'task'",
            ),
            include_types.contains(&NotificationCategory::Task).then_some(
                "n.event_item_type = 'document' AND COALESCE(n.metadata->>'subType', n.metadata->>'sub_type', '') = 'task'",
            ),
            include_types.contains(&NotificationCategory::Project)
                .then_some("n.event_item_type = 'project'"),
            include_types.contains(&NotificationCategory::Chat)
                .then_some("n.event_item_type = 'chat'"),
            include_types.contains(&NotificationCategory::Call)
                .then_some("n.event_item_type = 'call'"),
            include_types.contains(&NotificationCategory::Github)
                .then_some(GITHUB_EVENT_TYPES_SQL),
            include_types.contains(&NotificationCategory::Reminder)
                .then_some("n.event_item_type = 'reminder'"),
            include_types.contains(&NotificationCategory::Calendar)
                .then_some("n.event_item_type = 'calendar_event'"),
            include_types.contains(&NotificationCategory::Agent)
                .then_some("n.event_item_type = 'agent_session'"),
        ]
        .into_iter()
        .flatten()
        {
            if needs_or {
                builder.push(" OR ");
            }
            builder.push("(");
            builder.push(clause);
            builder.push(")");
            needs_or = true;
        }
        builder.push(")");
    }
}

fn push_entities_filter<'a>(
    builder: &mut QueryBuilder<'a, Postgres>,
    entities: &'a [Entity<'static>],
) {
    if entities.is_empty() {
        return;
    }

    builder.push(" AND (");
    for (index, entity) in entities.iter().enumerate() {
        if index > 0 {
            builder.push(" OR ");
        }

        builder.push("((n.event_item_type = ");
        builder.push_bind(entity.entity_type.as_ref());
        builder.push(" AND n.event_item_id = ");
        builder.push_bind(entity.entity_id.as_ref());
        builder.push(") OR (n.secondary_event_item_type = ");
        builder.push_bind(entity.entity_type.as_ref());
        builder.push(" AND n.secondary_event_item_id = ");
        builder.push_bind(entity.entity_id.as_ref());
        builder.push(")");

        if entity.entity_type == EntityType::ChannelMessage {
            builder
                .push(" OR COALESCE(n.metadata->>'messageId', n.metadata->>'message_id', '') = ");
            builder.push_bind(entity.entity_id.as_ref());
        }

        builder.push(")");
    }
    builder.push(")");
}

fn message_ref_matches_row(
    message_id: &str,
    secondary_event_item_id: Option<&str>,
    secondary_event_item_type: Option<&str>,
    metadata: &serde_json::Value,
) -> bool {
    let directly_targets_message = metadata
        .get("messageId")
        .or_else(|| metadata.get("message_id"))
        .and_then(|value| value.as_str())
        .is_some_and(|stored_message_id| stored_message_id == message_id);
    let targets_message_as_thread = secondary_event_item_type == Some("channel_message")
        && secondary_event_item_id == Some(message_id);

    directly_targets_message || targets_message_as_thread
}

fn notification_entity_matches_row(
    entity: &Entity<'_>,
    event_item_id: &str,
    event_item_type: &str,
    secondary_event_item_id: Option<&str>,
    secondary_event_item_type: Option<&str>,
    metadata: &serde_json::Value,
) -> bool {
    let directly_targets_entity = event_item_type == entity.entity_type.as_ref()
        && event_item_id == entity.entity_id.as_ref();
    let targets_secondary_entity = secondary_event_item_type == Some(entity.entity_type.as_ref())
        && secondary_event_item_id == Some(entity.entity_id.as_ref());
    let targets_message = entity.entity_type == EntityType::ChannelMessage
        && message_ref_matches_row(
            entity.entity_id.as_ref(),
            secondary_event_item_id,
            secondary_event_item_type,
            metadata,
        );

    directly_targets_entity || targets_secondary_entity || targets_message
}

fn push_cursor_filter(
    builder: &mut QueryBuilder<'_, Postgres>,
    cursor_timestamp: Option<DateTime<Utc>>,
    cursor_id: Option<Uuid>,
) {
    if let (Some(cursor_timestamp), Some(cursor_id)) = (cursor_timestamp, cursor_id) {
        builder.push(" AND (un.created_at, un.notification_id) < (");
        builder.push_bind(cursor_timestamp);
        builder.push(", ");
        builder.push_bind(cursor_id);
        builder.push(")");
    }
}

/// Local representation of the `notification_device_type_option` Postgres enum
/// for compile-time checked sqlx queries. The domain `DeviceType` stays
/// sqlx-free; adapters convert at the boundary.
#[derive(Debug, sqlx::Type)]
#[sqlx(
    type_name = "notification_device_type_option",
    rename_all = "lowercase"
)]
pub(crate) enum DbDeviceType {
    Ios,
    Android,
    #[sqlx(rename = "iosvoip")]
    IosVoip,
}

impl From<&DeviceType> for DbDeviceType {
    fn from(value: &DeviceType) -> Self {
        match value {
            DeviceType::Ios => Self::Ios,
            DeviceType::Android => Self::Android,
            DeviceType::IosVoip => Self::IosVoip,
        }
    }
}

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
pub trait NotificationDbOps: DeviceRegistrationDbOps + Send + Sync + 'static {
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
    fn create_notification<'a, T: Serialize + Send + Sync>(
        &self,
        request: SendNotificationRequestBuilder<'a, TaggedContent<T>>,
        notification_id: Uuid,
        service_name: &str,
        apns_collapse_key: Option<&str>,
    ) -> impl std::future::Future<Output = Result<Option<Vec<UserNotificationRow<Arc<T>>>>, Report>> + Send;

    /// Update the sent status for recipients who received the notification.
    fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Atomically acknowledge notifications, preserving done state and existing view times.
    fn mark_notifications_seen(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> impl std::future::Future<
        Output = Result<Vec<UserNotificationRow<serde_json::Value>>, Report>,
    > + Send;

    /// Atomically mark done or reopen done notifications as seen, preserving view times.
    fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> impl std::future::Future<
        Output = Result<Vec<UserNotificationRow<serde_json::Value>>, Report>,
    > + Send;

    /// Get active user-owned notification IDs associated with any primary or secondary entity.
    fn get_notification_ids_for_entities(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> impl std::future::Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Get basic notification data (collapse keys) for push clearing.
    fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> impl std::future::Future<Output = Result<Vec<NotificationIdAndCollapseKey>, Report>> + Send;

    /// Return notification IDs that still exist for the user and are eligible for digest email.
    ///
    /// Includes only unseen notifications that exist and are not soft-deleted.
    fn get_digest_eligible_notification_ids(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> impl std::future::Future<Output = Result<HashSet<Uuid>, Report>> + Send;

    /// Get a user's non-deleted notifications with cursor-based pagination.
    ///
    /// The metadata JSON column is deserialized into `T`. `filters` selects exact states.
    fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> impl std::future::Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send;

    /// Get a user's non-deleted notifications filtered by event item IDs, with cursor-based pagination.
    fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        event_item_ids: &[Uuid],
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> impl std::future::Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send;

    /// Get a user's active notifications for multiple entities, grouped by requested entity.
    fn get_entity_notifications_batch(
        &self,
        user_id: MacroUserIdStr<'_>,
        entities: Vec<Entity<'static>>,
    ) -> impl std::future::Future<
        Output = Result<
            HashMap<Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>,
            Report,
        >,
    > + Send;

    /// Get a single user notification by ID.
    fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> impl std::future::Future<Output = Result<Option<UserNotificationRow<T>>, Report>> + Send;

    /// Soft-delete a single user notification.
    fn delete_user_notification(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Soft-delete multiple user notifications.
    fn bulk_delete_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Hard-delete all notifications for a user.
    fn delete_all_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Get users (from the given set) who have disabled the specified notification type.
    fn get_users_with_type_disabled<'a>(
        &self,
        notification_event_type: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> impl std::future::Future<Output = Result<HashSet<MacroUserIdStr<'static>>, Report>> + Send;

    /// Get all disabled notification types for a user.
    fn get_disabled_notification_types(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl std::future::Future<Output = Result<Vec<DisabledNotificationType>, Report>> + Send;

    /// Disable a notification type for a user (insert).
    fn disable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Re-enable a notification type for a user (delete).
    fn enable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;
}

impl NotificationDbOps for PgPool {
    async fn get_muted_users<'a>(
        &self,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();

        let muted_users: Vec<String> = sqlx::query_scalar!(
            r#"
            SELECT user_id FROM user_mute_notification
            WHERE user_id = ANY($1)
            "#,
            &ids
        )
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

        let unsubscribed: Vec<String> = sqlx::query_scalar!(
            r#"
            SELECT user_id FROM user_notification_item_unsubscribe
            WHERE item_id = $1 AND user_id = ANY($2)
            "#,
            item_id,
            &ids
        )
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

        let rows = sqlx::query!(
            r#"
            SELECT user_id, device_endpoint, device_type as "device_type: DbDeviceType"
            FROM notification_user_device_registration
            WHERE user_id = ANY($1)
            "#,
            &ids
        )
        .fetch_all(self)
        .await?;

        let mut result: HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>> = HashMap::new();

        for row in rows {
            let Ok(parsed_id) = MacroUserIdStr::parse_from_str(&row.user_id) else {
                continue;
            };

            let device = match row.device_type {
                DbDeviceType::Ios => DeviceEndpoint::Ios(row.device_endpoint),
                DbDeviceType::Android => DeviceEndpoint::Android(row.device_endpoint),
                DbDeviceType::IosVoip => DeviceEndpoint::IosVoip(row.device_endpoint),
            };

            result
                .entry(parsed_id.into_owned())
                .or_default()
                .push(device);
        }

        Ok(result)
    }

    async fn create_notification<'a, T: Serialize + Send + Sync>(
        &self,
        request: SendNotificationRequestBuilder<'a, TaggedContent<T>>,
        notification_id: Uuid,
        service_name: &str,
        apns_collapse_key: Option<&str>,
    ) -> Result<Option<Vec<UserNotificationRow<Arc<T>>>>, Report> {
        let entity_type: &str = request.notification_entity.entity_type.into();
        let secondary_entity_id = request
            .secondary_notification_entity
            .as_ref()
            .map(|entity| entity.entity_id.as_ref());
        let secondary_entity_type: Option<&str> = request
            .secondary_notification_entity
            .as_ref()
            .map(|entity| entity.entity_type.into());
        let metadata = serde_json::to_value(&request.notification.content)?;

        let mut tx = self.begin().await?;

        let sender_id = request.sender_id.as_ref().map(|id| id.to_string());
        let typename = request.notification.tag.as_ref();

        // Insert notification
        let result = sqlx::query!(
            r#"
            INSERT INTO notification (
                id,
                notification_event_type,
                event_item_id,
                event_item_type,
                service_sender,
                metadata,
                sender_id,
                apns_collapse_key,
                secondary_event_item_id,
                secondary_event_item_type
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO NOTHING
            "#,
            notification_id,
            typename,
            request.notification_entity.entity_id.as_ref(),
            entity_type,
            service_name,
            metadata as serde_json::Value,
            sender_id,
            apns_collapse_key,
            secondary_entity_id,
            secondary_entity_type
        )
        .execute(&mut *tx)
        .await?;

        // Return None early if notification already exists (conflict)
        if result.rows_affected() == 0 {
            return Ok(None);
        }

        // Insert user notifications
        let user_ids: Vec<String> = request
            .recipient_ids
            .iter()
            .map(|id| id.to_string())
            .collect();

        let created_at = sqlx::query_scalar!(
            r#"
            INSERT INTO user_notification (notification_id, user_id)
            SELECT $1, user_id
            FROM UNNEST($2::text[]) as user_id
            RETURNING created_at::timestamptz as "created_at!"
            "#,
            notification_id,
            &user_ids
        )
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        let entity = request.notification_entity.clone().into_owned();
        let sender_id = request.sender_id.as_ref().map(|id| id.clone().into_owned());

        let n = Arc::new(request.notification.content);

        let rows = request
            .recipient_ids
            .iter()
            .map(|recipient| UserNotificationRow {
                owner_id: recipient.clone().into_owned(),
                notification_id,
                notification_event_type: typename.to_string(),
                entity: entity.clone(),
                sent: false,
                state: NotificationState::Unseen,
                created_at,
                viewed_at: None,
                updated_at: created_at,
                deleted_at: None,
                notification_metadata: n.clone(),
                sender_id: sender_id.clone(),
            })
            .collect();

        Ok(Some(rows))
    }

    async fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();

        sqlx::query!(
            r#"
            UPDATE user_notification
            SET sent = true
            WHERE notification_id = $1 AND user_id = ANY($2)
            "#,
            notification_id,
            &ids
        )
        .execute(self)
        .await?;

        Ok(())
    }

    async fn mark_notifications_seen(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        let rows = sqlx::query_as!(
            UpdatedUserNotificationRow,
            r#"
            WITH updated AS (
                UPDATE user_notification
                SET state = CASE WHEN state = 'unseen' THEN 'seen'::notification_state ELSE state END,
                    seen_at = COALESCE(seen_at, NOW())
                WHERE user_id = $1 AND notification_id = ANY($2) AND deleted_at IS NULL
                RETURNING
                    user_id,
                    notification_id,
                    sent,
                    state,
                    created_at,
                    seen_at,
                    deleted_at
            )
            SELECT
                updated.user_id as owner_id,
                updated.notification_id,
                n.event_item_id,
                n.event_item_type,
                updated.sent,
                updated.state as "state!: NotificationState",
                updated.created_at::timestamptz as "created_at!",
                updated.seen_at::timestamptz as viewed_at,
                NOW()::timestamptz as "updated_at!",
                updated.deleted_at::timestamptz,
                n.metadata as "notification_metadata: serde_json::Value",
                n.notification_event_type,
                n.sender_id
            FROM updated
            JOIN notification n ON n.id = updated.notification_id
            ORDER BY array_position($2, updated.notification_id)
            "#,
            user_id.as_ref(),
            notification_ids,
        )
        .fetch_all(self)
        .await?;

        rows.into_iter()
            .map(UpdatedUserNotificationRow::into_domain)
            .collect()
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        let rows = sqlx::query_as!(
            UpdatedUserNotificationRow,
            r#"
            WITH updated AS (
                UPDATE user_notification
                SET state = CASE
                    WHEN $3 THEN 'done'::notification_state
                    WHEN state = 'done' THEN 'seen'::notification_state
                    ELSE state
                END
                WHERE user_id = $1 AND notification_id = ANY($2) AND deleted_at IS NULL
                RETURNING
                    user_id,
                    notification_id,
                    sent,
                    state,
                    created_at,
                    seen_at,
                    deleted_at
            )
            SELECT
                updated.user_id as owner_id,
                updated.notification_id,
                n.event_item_id,
                n.event_item_type,
                updated.sent,
                updated.state as "state!: NotificationState",
                updated.created_at::timestamptz as "created_at!",
                updated.seen_at::timestamptz as viewed_at,
                NOW()::timestamptz as "updated_at!",
                updated.deleted_at::timestamptz,
                n.metadata as "notification_metadata: serde_json::Value",
                n.notification_event_type,
                n.sender_id
            FROM updated
            JOIN notification n ON n.id = updated.notification_id
            ORDER BY array_position($2, updated.notification_id)
            "#,
            user_id.as_ref(),
            notification_ids,
            done,
        )
        .fetch_all(self)
        .await?;

        rows.into_iter()
            .map(UpdatedUserNotificationRow::into_domain)
            .collect()
    }

    async fn get_notification_ids_for_entities(
        &self,
        user_id: &MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> Result<Vec<Uuid>, Report> {
        let entity_types = entities
            .iter()
            .map(|entity| entity.entity_type.as_ref().to_owned())
            .collect::<Vec<_>>();
        let entity_ids = entities
            .iter()
            .map(|entity| entity.entity_id.to_string())
            .collect::<Vec<_>>();
        let notification_ids = sqlx::query_scalar!(
            r#"
            WITH requested_entities AS (
                SELECT entity_type, entity_id
                FROM UNNEST($2::text[], $3::text[]) AS entity(entity_type, entity_id)
            )
            SELECT un.notification_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.user_id = $1
              AND un.deleted_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM requested_entities entity
                  WHERE (
                      n.event_item_type = entity.entity_type
                      AND n.event_item_id = entity.entity_id
                  )
                  OR (
                      n.secondary_event_item_type = entity.entity_type
                      AND n.secondary_event_item_id = entity.entity_id
                  )
                  OR (
                      entity.entity_type = 'channel_message'
                      AND COALESCE(n.metadata->>'messageId', n.metadata->>'message_id', '') = entity.entity_id
                  )
              )
            ORDER BY un.created_at, un.notification_id
            "#,
            user_id.as_ref(),
            &entity_types,
            &entity_ids,
        )
        .fetch_all(self)
        .await?;

        Ok(notification_ids)
    }

    async fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> Result<Vec<NotificationIdAndCollapseKey>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT id, apns_collapse_key as "apns_collapse_key!: String"
            FROM notification
            WHERE id = ANY($1) AND apns_collapse_key IS NOT NULL
            "#,
            notification_ids
        )
        .fetch_all(self)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| NotificationIdAndCollapseKey {
                id: row.id,
                apns_collapse_key: row.apns_collapse_key,
            })
            .collect())
    }

    async fn get_digest_eligible_notification_ids(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, Report> {
        let user_id_str = user_id.to_string();

        let rows = sqlx::query!(
            r#"
            SELECT un.notification_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.user_id = $1
              AND un.notification_id = ANY($2)
              AND un.deleted_at IS NULL
              AND un.state = 'unseen'
            "#,
            user_id_str,
            notification_ids
        )
        .fetch_all(self)
        .await?;

        Ok(rows.into_iter().map(|row| row.notification_id).collect())
    }

    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        let query_limit = limit as i64;
        let (cursor_id, cursor_timestamp) = cursor.vals();

        let rows = build_user_notifications_query(UserNotificationsQueryArgs {
            user_id: user_id.as_ref(),
            event_item_ids: None,
            limit: query_limit,
            cursor_id: cursor_id.copied(),
            cursor_timestamp: cursor_timestamp.copied(),
            filters: &filters,
        })
        .build_query_as::<UserNotificationListRow>()
        .fetch_all(self)
        .await?;

        let mut notifications = Vec::with_capacity(rows.len());
        for row in rows {
            let (
                owner_id,
                notification_id,
                event_item_id,
                event_item_type,
                sent,
                state,
                created_at,
                viewed_at,
                updated_at,
                deleted_at,
                notification_metadata,
                notification_event_type,
                sender_id,
            ) = row;

            let entity = match EntityType::from_str(&event_item_type) {
                Ok(entity_type) => entity_type.with_entity_string(event_item_id),
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let sender_id = match sender_id
                .map(|s| MacroUserIdStr::parse_from_str(&s).map(CowLike::into_owned))
                .transpose()
            {
                Ok(sender_id) => sender_id,
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let owner_id = match MacroUserIdStr::parse_from_str(&owner_id).map(CowLike::into_owned)
            {
                Ok(owner_id) => owner_id,
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let notification_metadata = match serde_json::from_value::<T>(notification_metadata) {
                Ok(metadata) => metadata,
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };

            notifications.push(UserNotificationRow {
                owner_id,
                notification_id,
                notification_event_type,
                entity,
                sent,
                state,
                created_at,
                viewed_at,
                updated_at,
                deleted_at,
                notification_metadata,
                sender_id,
            });
        }

        Ok(notifications)
    }

    async fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        event_item_ids: &[Uuid],
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        let query_limit = limit as i64;
        let (cursor_id, cursor_timestamp) = cursor.vals();
        let event_item_ids: Vec<String> = event_item_ids.iter().map(|id| id.to_string()).collect();

        let rows = build_user_notifications_query(UserNotificationsQueryArgs {
            user_id: user_id.as_ref(),
            event_item_ids: Some(&event_item_ids),
            limit: query_limit,
            cursor_id: cursor_id.copied(),
            cursor_timestamp: cursor_timestamp.copied(),
            filters: &filters,
        })
        .build_query_as::<UserNotificationListRow>()
        .fetch_all(self)
        .await?;

        let mut notifications = Vec::with_capacity(rows.len());
        for row in rows {
            let (
                owner_id,
                notification_id,
                event_item_id,
                event_item_type,
                sent,
                state,
                created_at,
                viewed_at,
                updated_at,
                deleted_at,
                notification_metadata,
                notification_event_type,
                sender_id,
            ) = row;

            let entity = match EntityType::from_str(&event_item_type) {
                Ok(entity_type) => entity_type.with_entity_string(event_item_id),
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let sender_id = match sender_id
                .map(|s| MacroUserIdStr::parse_from_str(&s).map(CowLike::into_owned))
                .transpose()
            {
                Ok(sender_id) => sender_id,
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let owner_id = match MacroUserIdStr::parse_from_str(&owner_id).map(CowLike::into_owned)
            {
                Ok(owner_id) => owner_id,
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let notification_metadata = match serde_json::from_value::<T>(notification_metadata) {
                Ok(metadata) => metadata,
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };

            notifications.push(UserNotificationRow {
                owner_id,
                notification_id,
                notification_event_type,
                entity,
                sent,
                state,
                created_at,
                viewed_at,
                updated_at,
                deleted_at,
                notification_metadata,
                sender_id,
            });
        }

        Ok(notifications)
    }

    async fn get_entity_notifications_batch(
        &self,
        user_id: MacroUserIdStr<'_>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>, Report> {
        let mut seen_entities = HashSet::new();
        let entities = entities
            .into_iter()
            .filter(|entity| seen_entities.insert(entity.clone()))
            .collect::<Vec<_>>();

        let mut result = entities
            .iter()
            .cloned()
            .map(|entity| (entity, Vec::new()))
            .collect::<HashMap<_, _>>();

        if entities.is_empty() {
            return Ok(result);
        }

        let filters = NotificationListFilters {
            states: NotificationState::ACTIVE.to_vec(),
            include_types: Vec::new(),
            entities: entities.clone(),
        };

        let mut builder = QueryBuilder::new(
            r#"
            SELECT
                un.user_id as owner_id,
                un.notification_id,
                n.event_item_id,
                n.event_item_type,
                n.secondary_event_item_id,
                n.secondary_event_item_type,
                un.sent,
                un.state,
                un.created_at::timestamptz as created_at,
                un.seen_at::timestamptz as viewed_at,
                un.created_at::timestamptz as updated_at,
                un.deleted_at::timestamptz as deleted_at,
                n.metadata as notification_metadata,
                n.notification_event_type as notification_event_type,
                n.sender_id as sender_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.user_id = "#,
        );
        builder.push_bind(user_id.as_ref());
        push_notification_status_filters(&mut builder, &filters);
        push_entities_filter(&mut builder, &entities);
        builder.push(" ORDER BY un.created_at DESC, un.notification_id DESC");

        let rows = builder
            .build_query_as::<EntityNotificationListRow>()
            .fetch_all(self)
            .await?;

        for row in rows {
            let EntityNotificationListRow {
                owner_id,
                notification_id,
                event_item_id,
                event_item_type,
                secondary_event_item_id,
                secondary_event_item_type,
                sent,
                state,
                created_at,
                viewed_at,
                updated_at,
                deleted_at,
                notification_metadata,
                notification_event_type,
                sender_id,
            } = row;

            let entity = match EntityType::from_str(&event_item_type) {
                Ok(entity_type) => entity_type.with_entity_string(event_item_id.clone()),
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let sender_id = match sender_id
                .map(|s| MacroUserIdStr::parse_from_str(&s).map(CowLike::into_owned))
                .transpose()
            {
                Ok(sender_id) => sender_id,
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let owner_id = match MacroUserIdStr::parse_from_str(&owner_id).map(CowLike::into_owned)
            {
                Ok(owner_id) => owner_id,
                Err(e) => {
                    tracing::debug!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };

            let notification = UserNotificationRow {
                owner_id,
                notification_id,
                notification_event_type: notification_event_type.clone(),
                entity,
                sent,
                state,
                created_at,
                viewed_at,
                updated_at,
                deleted_at,
                notification_metadata: notification_metadata.clone(),
                sender_id,
            };

            for requested_entity in &entities {
                if notification_entity_matches_row(
                    requested_entity,
                    &event_item_id,
                    &event_item_type,
                    secondary_event_item_id.as_deref(),
                    secondary_event_item_type.as_deref(),
                    &notification_metadata,
                ) {
                    result
                        .entry(requested_entity.clone())
                        .or_default()
                        .push(notification.clone());
                }
            }
        }

        Ok(result)
    }

    async fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<Option<UserNotificationRow<T>>, Report> {
        let row = sqlx::query!(
            r#"
            SELECT
                un.user_id as owner_id,
                un.notification_id,
                n.event_item_id,
                n.event_item_type,
                un.sent,
                un.state as "state!: NotificationState",
                un.created_at::timestamptz as "created_at!",
                un.seen_at::timestamptz as viewed_at,
                un.created_at::timestamptz as "updated_at!",
                un.deleted_at::timestamptz,
                n.metadata as "notification_metadata: serde_json::Value",
                n.notification_event_type as notification_event_type,
                n.sender_id as sender_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.user_id = $1
            AND un.notification_id = $2
            AND un.deleted_at IS NULL
            LIMIT 1
            "#,
            user_id.as_ref(),
            notification_id,
        )
        .fetch_optional(self)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let entity = EntityType::from_str(&row.event_item_type)
            .map_err(|e| rootcause::report!(e))?
            .with_entity_string(row.event_item_id);

        let sender_id = row
            .sender_id
            .as_deref()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .transpose()
            .map_err(|e| rootcause::report!(e))?;

        let owner_id = MacroUserIdStr::parse_from_str(&row.owner_id)
            .map(CowLike::into_owned)
            .map_err(|e| rootcause::report!(e))?;

        let notification_metadata = serde_json::from_value::<T>(row.notification_metadata)
            .map_err(|e| rootcause::report!(e))?;

        Ok(Some(UserNotificationRow {
            owner_id,
            notification_id: row.notification_id,
            notification_event_type: row.notification_event_type,
            entity,
            sent: row.sent,
            state: row.state,
            created_at: row.created_at,
            viewed_at: row.viewed_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            notification_metadata,
            sender_id,
        }))
    }

    async fn delete_user_notification(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE user_notification
            SET deleted_at = NOW()
            WHERE user_id = $1 AND notification_id = $2
            "#,
            user_id.as_ref(),
            notification_id,
        )
        .execute(self)
        .await?;

        Ok(())
    }

    async fn bulk_delete_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE user_notification
            SET deleted_at = NOW()
            WHERE user_id = $1 AND notification_id = ANY($2)
            "#,
            user_id.as_ref(),
            notification_ids,
        )
        .execute(self)
        .await?;

        Ok(())
    }

    async fn delete_all_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            DELETE FROM user_notification
            WHERE user_id = $1
            "#,
            user_id.as_ref(),
        )
        .execute(self)
        .await?;

        Ok(())
    }

    async fn get_users_with_type_disabled<'a>(
        &self,
        notification_event_type: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();

        let disabled: Vec<String> = sqlx::query_scalar!(
            r#"
            SELECT user_id FROM user_notification_type_preference
            WHERE notification_event_type = $1 AND user_id = ANY($2)
            "#,
            notification_event_type,
            &ids
        )
        .fetch_all(self)
        .await?;

        let result = disabled
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

    async fn get_disabled_notification_types(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<DisabledNotificationType>, Report> {
        let rows = sqlx::query!(
            r#"
            SELECT user_id, notification_event_type
            FROM user_notification_type_preference
            WHERE user_id = $1
            "#,
            user_id.as_ref()
        )
        .fetch_all(self)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let user_id = MacroUserIdStr::parse_from_str(&row.user_id)
                    .map(CowLike::into_owned)
                    .ok()?
                    .into_owned();
                Some(DisabledNotificationType {
                    user_id,
                    notification_event_type: row.notification_event_type,
                })
            })
            .collect())
    }

    async fn disable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            INSERT INTO user_notification_type_preference (user_id, notification_event_type)
            VALUES ($1, $2)
            ON CONFLICT (user_id, notification_event_type) DO NOTHING
            "#,
            user_id.as_ref(),
            notification_event_type
        )
        .execute(self)
        .await?;

        Ok(())
    }

    async fn enable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            DELETE FROM user_notification_type_preference
            WHERE user_id = $1 AND notification_event_type = $2
            "#,
            user_id.as_ref(),
            notification_event_type
        )
        .execute(self)
        .await?;

        Ok(())
    }
}

impl NotificationDeliveryRepository for DbNotificationRepository<PgPool> {
    async fn restore_existing_delivery_request<
        'a,
        T: Serialize + Send + Sync,
        U: Serialize + Send + Sync,
    >(
        &self,
        request: &SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<HashSet<MacroUserIdStr<'static>>>, Report> {
        let notification_id = request.uuid_to_write;
        let mut tx = self.db.begin().await?;
        let exists = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM notification WHERE id = $1) AS \"exists!\"",
            notification_id,
        )
        .fetch_one(&mut *tx)
        .await?;
        if !exists {
            tx.commit().await?;
            return Ok(None);
        }

        let user_ids = sqlx::query_scalar!(
            r#"
            SELECT user_id
            FROM user_notification
            WHERE notification_id = $1
            ORDER BY user_id
            "#,
            notification_id,
        )
        .fetch_all(&mut *tx)
        .await?;
        let recipients = user_ids
            .iter()
            .map(|user_id| MacroUserIdStr::parse_from_str(user_id).map(CowLike::into_owned))
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|error| rootcause::report!(error))?;

        let mut restored: SendNotificationRequest<'static, serde_json::Value, serde_json::Value> =
            serde_json::from_value(serde_json::to_value(request)?)?;
        restored.req.recipient_ids = recipients.clone();
        let delivery_request = serde_json::to_value(restored)?;
        let generation = macro_uuid::generate_uuid_v7();
        let restored_outbox = sqlx::query_scalar!(
            r#"
            INSERT INTO notification_delivery_outbox (notification_id, generation, request)
            VALUES ($1, $2, $3)
            ON CONFLICT (notification_id) DO NOTHING
            RETURNING notification_id
            "#,
            notification_id,
            generation,
            delivery_request,
        )
        .fetch_optional(&mut *tx)
        .await?
        .is_some();

        if restored_outbox {
            sqlx::query!(
                r#"
                INSERT INTO notification_digest_receipt_cleanup (
                    notification_id,
                    user_id,
                    generation
                )
                SELECT notification_id, user_id, $2
                FROM user_notification
                WHERE notification_id = $1
                ON CONFLICT (notification_id, user_id, generation) DO NOTHING
                "#,
                notification_id,
                generation,
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(Some(recipients))
    }

    async fn persist_notification_with_delivery_request<
        'a,
        T: Serialize + DeserializeOwned + Send + Sync,
        U: Serialize + Send + Sync,
    >(
        &self,
        mut request: SendNotificationRequest<'a, T, U>,
        service_sender: &str,
    ) -> Result<Vec<UserNotificationRow<Arc<T>>>, Report> {
        let notification_id = request.uuid_to_write;
        let entity_type: &str = request.req.notification_entity.entity_type.into();
        let secondary_entity_id = request
            .req
            .secondary_notification_entity
            .as_ref()
            .map(|entity| entity.entity_id.as_ref());
        let secondary_entity_type: Option<&str> = request
            .req
            .secondary_notification_entity
            .as_ref()
            .map(|entity| entity.entity_type.into());
        let metadata = serde_json::to_value(&request.req.notification.content)?;
        let sender_id = request.req.sender_id.as_ref().map(ToString::to_string);
        let typename = request.req.notification.tag.as_ref();
        let apns_collapse_key = request
            .build_apns
            .as_ref()
            .map(|output| output.attr.collapse_key.as_str());

        let mut tx = self.db.begin().await?;
        let inserted = sqlx::query!(
            r#"
            INSERT INTO notification (
                id,
                notification_event_type,
                event_item_id,
                event_item_type,
                service_sender,
                metadata,
                sender_id,
                apns_collapse_key,
                secondary_event_item_id,
                secondary_event_item_type
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id) DO NOTHING
            "#,
            notification_id,
            typename,
            request.req.notification_entity.entity_id.as_ref(),
            entity_type,
            service_sender,
            metadata,
            sender_id,
            apns_collapse_key,
            secondary_entity_id,
            secondary_entity_type,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;

        if inserted {
            let user_ids: Vec<String> = request
                .req
                .recipient_ids
                .iter()
                .map(ToString::to_string)
                .collect();
            sqlx::query!(
                r#"
                INSERT INTO user_notification (notification_id, user_id)
                SELECT $1, user_id
                FROM UNNEST($2::text[]) AS user_id
                "#,
                notification_id,
                &user_ids,
            )
            .execute(&mut *tx)
            .await?;
        }

        let stored_rows = sqlx::query!(
            r#"
            SELECT
                un.user_id,
                un.sent,
                un.state AS "state!: NotificationState",
                un.created_at::timestamptz AS "created_at!",
                un.seen_at::timestamptz AS viewed_at,
                un.deleted_at::timestamptz AS deleted_at,
                n.notification_event_type,
                n.event_item_id,
                n.event_item_type,
                n.metadata AS "metadata!: serde_json::Value",
                n.sender_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.notification_id = $1
            ORDER BY un.user_id
            "#,
            notification_id,
        )
        .fetch_all(&mut *tx)
        .await?;

        let persisted_recipients = stored_rows
            .iter()
            .map(|row| MacroUserIdStr::parse_from_str(&row.user_id).map(CowLike::into_owned))
            .collect::<Result<HashSet<_>, _>>()
            .map_err(|error| rootcause::report!(error))?;
        request.req.recipient_ids = persisted_recipients;

        let delivery_request = serde_json::to_value(&request)?;
        let generation = macro_uuid::generate_uuid_v7();
        let inserted_outbox = sqlx::query_scalar!(
            r#"
            INSERT INTO notification_delivery_outbox (notification_id, generation, request)
            VALUES ($1, $2, $3)
            ON CONFLICT (notification_id) DO NOTHING
            RETURNING notification_id
            "#,
            notification_id,
            generation,
            delivery_request,
        )
        .fetch_optional(&mut *tx)
        .await?
        .is_some();

        if inserted_outbox {
            sqlx::query!(
                r#"
                INSERT INTO notification_digest_receipt_cleanup (
                    notification_id,
                    user_id,
                    generation
                )
                SELECT notification_id, user_id, $2
                FROM user_notification
                WHERE notification_id = $1
                ON CONFLICT (notification_id, user_id, generation) DO NOTHING
                "#,
                notification_id,
                generation,
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        stored_rows
            .into_iter()
            .map(|row| {
                let owner_id = MacroUserIdStr::parse_from_str(&row.user_id)
                    .map(CowLike::into_owned)
                    .map_err(|error| rootcause::report!(error))?;
                let entity = EntityType::from_str(&row.event_item_type)
                    .map_err(|error| rootcause::report!(error))?
                    .with_entity_string(row.event_item_id);
                let sender_id = row
                    .sender_id
                    .as_deref()
                    .map(|sender| MacroUserIdStr::parse_from_str(sender).map(CowLike::into_owned))
                    .transpose()
                    .map_err(|error| rootcause::report!(error))?;
                let notification_metadata = serde_json::from_value(row.metadata)?;

                Ok(UserNotificationRow {
                    owner_id,
                    notification_id,
                    notification_event_type: row.notification_event_type,
                    entity,
                    sent: row.sent,
                    state: row.state,
                    created_at: row.created_at,
                    viewed_at: row.viewed_at,
                    updated_at: row.created_at,
                    deleted_at: row.deleted_at,
                    notification_metadata: Arc::new(notification_metadata),
                    sender_id,
                })
            })
            .collect()
    }

    async fn claim_delivery_request(
        &self,
        notification_id: Option<Uuid>,
        claim_token: DeliveryClaimToken,
        lease: DeliveryLease,
    ) -> Result<Option<ClaimedDeliveryRequest>, Report> {
        let claim_token_uuid = claim_token.into_uuid();
        let mut tx = self.db.begin().await?;
        let claimed = sqlx::query!(
            r#"
            WITH candidate AS (
                SELECT notification_id
                FROM notification_delivery_outbox
                WHERE prepared_at IS NULL
                  AND completed_at IS NULL
                  AND next_attempt_at <= now()
                  AND (claim_expires_at IS NULL OR claim_expires_at <= now())
                  AND ($1::uuid IS NULL OR notification_id = $1)
                ORDER BY next_attempt_at, created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE notification_delivery_outbox outbox
            SET claim_token = $2,
                claim_expires_at = $3,
                attempt_count = outbox.attempt_count + 1,
                updated_at = now()
            FROM candidate
            WHERE outbox.notification_id = candidate.notification_id
            RETURNING
                outbox.notification_id,
                outbox.generation,
                outbox.request AS "request!: serde_json::Value",
                outbox.attempt_count,
                outbox.created_at AS "created_at!"
            "#,
            notification_id,
            claim_token_uuid,
            lease.expires_at,
        )
        .fetch_optional(&mut *tx)
        .await?;

        let Some(claimed) = claimed else {
            tx.commit().await?;
            return Ok(None);
        };

        let rows = sqlx::query!(
            r#"
            SELECT
                un.user_id,
                un.sent,
                un.state AS "state!: NotificationState",
                un.created_at::timestamptz AS "created_at!",
                un.seen_at::timestamptz AS viewed_at,
                un.deleted_at::timestamptz AS deleted_at,
                n.notification_event_type,
                n.event_item_id,
                n.event_item_type,
                n.metadata AS "metadata!: serde_json::Value",
                n.sender_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.notification_id = $1
            ORDER BY un.user_id
            "#,
            claimed.notification_id,
        )
        .fetch_all(&mut *tx)
        .await?;

        tx.commit().await?;

        let notifications = rows
            .into_iter()
            .map(|row| {
                let owner_id = MacroUserIdStr::parse_from_str(&row.user_id)
                    .map(CowLike::into_owned)
                    .map_err(|error| rootcause::report!(error))?;
                let entity = EntityType::from_str(&row.event_item_type)
                    .map_err(|error| rootcause::report!(error))?
                    .with_entity_string(row.event_item_id);
                let sender_id = row
                    .sender_id
                    .as_deref()
                    .map(|sender| MacroUserIdStr::parse_from_str(sender).map(CowLike::into_owned))
                    .transpose()
                    .map_err(|error| rootcause::report!(error))?;

                Ok(UserNotificationRow {
                    owner_id,
                    notification_id: claimed.notification_id,
                    notification_event_type: row.notification_event_type,
                    entity,
                    sent: row.sent,
                    state: row.state,
                    created_at: row.created_at,
                    viewed_at: row.viewed_at,
                    updated_at: row.created_at,
                    deleted_at: row.deleted_at,
                    notification_metadata: row.metadata,
                    sender_id,
                })
            })
            .collect::<Result<Vec<_>, Report>>()?;

        Ok(Some(ClaimedDeliveryRequest {
            notification_id: claimed.notification_id,
            generation: claimed.generation,
            claim_token,
            request: claimed.request,
            notifications,
            attempt_count: claimed.attempt_count,
            pending_since: claimed.created_at,
        }))
    }

    async fn prepare_delivery_intents(
        &self,
        notification_id: Uuid,
        claim_token: DeliveryClaimToken,
        payloads: &[serde_json::Value],
        digest_receipt_cleanup_after: DateTime<Utc>,
    ) -> Result<bool, Report> {
        let claim_token_uuid = claim_token.into_uuid();
        let mut tx = self.db.begin().await?;
        let prepared = sqlx::query_scalar!(
            r#"
            UPDATE notification_delivery_outbox
            SET prepared_at = now(),
                completed_at = CASE WHEN $3 = 0 THEN now() ELSE completed_at END,
                claim_token = NULL,
                claim_expires_at = NULL,
                updated_at = now()
            WHERE notification_id = $1
              AND claim_token = $2
              AND claim_expires_at > now()
              AND prepared_at IS NULL
            RETURNING notification_id
            "#,
            notification_id,
            claim_token_uuid,
            i32::try_from(payloads.len())?,
        )
        .fetch_optional(&mut *tx)
        .await?
        .is_some();

        if !prepared {
            tx.rollback().await?;
            return Ok(false);
        }

        for (position, payload) in payloads.iter().enumerate() {
            sqlx::query!(
                r#"
                INSERT INTO notification_delivery_outbox_intent (
                    notification_id,
                    position,
                    payload
                )
                VALUES ($1, $2, $3)
                ON CONFLICT (notification_id, position) DO NOTHING
                "#,
                notification_id,
                i32::try_from(position)?,
                payload,
            )
            .execute(&mut *tx)
            .await?;
        }

        sqlx::query!(
            r#"
            UPDATE notification_digest_receipt_cleanup cleanup
            SET safe_after = $2,
                claim_token = NULL,
                claim_expires_at = NULL,
                updated_at = now()
            FROM notification_delivery_outbox outbox
            WHERE cleanup.notification_id = $1
              AND outbox.notification_id = cleanup.notification_id
              AND outbox.generation = cleanup.generation
            "#,
            notification_id,
            digest_receipt_cleanup_after,
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(true)
    }

    async fn release_delivery_request(
        &self,
        notification_id: Uuid,
        claim_token: DeliveryClaimToken,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE notification_delivery_outbox
            SET claim_token = NULL,
                claim_expires_at = NULL,
                next_attempt_at = now() + make_interval(
                    secs => LEAST(300, power(2, LEAST(attempt_count, 8))::integer)
                ),
                updated_at = now()
            WHERE notification_id = $1 AND claim_token = $2
            "#,
            notification_id,
            claim_token.into_uuid(),
        )
        .execute(&self.db)
        .await?;
        Ok(())
    }

    async fn claim_delivery_intent(
        &self,
        notification_id: Option<Uuid>,
        claim_token: DeliveryClaimToken,
        lease: DeliveryLease,
    ) -> Result<Option<ClaimedDeliveryIntent>, Report> {
        let claim_token_uuid = claim_token.into_uuid();
        let claimed = sqlx::query!(
            r#"
            WITH candidate AS (
                SELECT intent.notification_id, intent.position
                FROM notification_delivery_outbox_intent intent
                JOIN notification_delivery_outbox outbox
                  ON outbox.notification_id = intent.notification_id
                WHERE intent.published_at IS NULL
                  AND intent.next_attempt_at <= now()
                  AND (intent.claim_expires_at IS NULL OR intent.claim_expires_at <= now())
                  AND outbox.prepared_at IS NOT NULL
                  AND outbox.completed_at IS NULL
                  AND ($1::uuid IS NULL OR intent.notification_id = $1)
                ORDER BY
                    intent.next_attempt_at,
                    intent.created_at,
                    intent.notification_id,
                    intent.position
                FOR UPDATE OF intent SKIP LOCKED
                LIMIT 1
            )
            UPDATE notification_delivery_outbox_intent intent
            SET claim_token = $2,
                claim_expires_at = $3,
                attempt_count = intent.attempt_count + 1,
                updated_at = now()
            FROM candidate
            WHERE intent.notification_id = candidate.notification_id
              AND intent.position = candidate.position
            RETURNING
                intent.notification_id,
                intent.position,
                intent.payload AS "payload!: serde_json::Value",
                intent.attempt_count,
                intent.created_at AS "created_at!"
            "#,
            notification_id,
            claim_token_uuid,
            lease.expires_at,
        )
        .fetch_optional(&self.db)
        .await?;

        Ok(claimed.map(|claimed| ClaimedDeliveryIntent {
            notification_id: claimed.notification_id,
            position: claimed.position,
            claim_token,
            payload: claimed.payload,
            attempt_count: claimed.attempt_count,
            pending_since: claimed.created_at,
        }))
    }

    async fn complete_delivery_intent(
        &self,
        notification_id: Uuid,
        position: i32,
        claim_token: DeliveryClaimToken,
    ) -> Result<bool, Report> {
        let mut tx = self.db.begin().await?;
        // Serialize final-intent completion per notification. Without this
        // parent lock, two concurrent final completions can each observe the
        // other's still-uncommitted intent and both skip completing the parent.
        let parent_exists = sqlx::query_scalar!(
            r#"
            SELECT notification_id
            FROM notification_delivery_outbox
            WHERE notification_id = $1
            FOR UPDATE
            "#,
            notification_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .is_some();
        if !parent_exists {
            tx.commit().await?;
            return Ok(false);
        }

        let updated = sqlx::query_scalar!(
            r#"
            UPDATE notification_delivery_outbox_intent
            SET published_at = now(),
                claim_token = NULL,
                claim_expires_at = NULL,
                updated_at = now()
            WHERE notification_id = $1
              AND position = $2
              AND claim_token = $3
              AND claim_expires_at > now()
              AND published_at IS NULL
            RETURNING notification_id
            "#,
            notification_id,
            position,
            claim_token.into_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await?
        .is_some();

        if updated {
            sqlx::query!(
                r#"
                UPDATE notification_delivery_outbox outbox
                SET completed_at = now(), updated_at = now()
                WHERE outbox.notification_id = $1
                  AND outbox.completed_at IS NULL
                  AND NOT EXISTS (
                      SELECT 1
                      FROM notification_delivery_outbox_intent intent
                      WHERE intent.notification_id = outbox.notification_id
                        AND intent.published_at IS NULL
                  )
                "#,
                notification_id,
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(updated)
    }

    async fn release_delivery_intent(
        &self,
        notification_id: Uuid,
        position: i32,
        claim_token: DeliveryClaimToken,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE notification_delivery_outbox_intent
            SET claim_token = NULL,
                claim_expires_at = NULL,
                next_attempt_at = now() + make_interval(
                    secs => LEAST(300, power(2, LEAST(attempt_count, 8))::integer)
                ),
                updated_at = now()
            WHERE notification_id = $1
              AND position = $2
              AND claim_token = $3
            "#,
            notification_id,
            position,
            claim_token.into_uuid(),
        )
        .execute(&self.db)
        .await?;
        Ok(())
    }

    async fn claim_digest_receipt_cleanup(
        &self,
        claim_token: DeliveryClaimToken,
        lease: DeliveryLease,
        orphan_cleanup_after: DateTime<Utc>,
    ) -> Result<Option<ClaimedDigestReceiptCleanup>, Report> {
        let claim_token_uuid = claim_token.into_uuid();
        let mut tx = self.db.begin().await?;

        // A notification can be deleted while preparation is in flight. The
        // outbox cascade cancels delivery, while this durable obligation keeps
        // the Redis receipt until every bounded claimant has stopped.
        sqlx::query!(
            r#"
            UPDATE notification_digest_receipt_cleanup cleanup
            SET safe_after = $1,
                updated_at = now()
            WHERE cleanup.safe_after IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM notification_delivery_outbox outbox
                  WHERE outbox.notification_id = cleanup.notification_id
                    AND outbox.generation = cleanup.generation
              )
            "#,
            orphan_cleanup_after,
        )
        .execute(&mut *tx)
        .await?;

        let claimed = sqlx::query!(
            r#"
            WITH candidate AS (
                SELECT cleanup.notification_id, cleanup.user_id, cleanup.generation
                FROM notification_digest_receipt_cleanup cleanup
                WHERE cleanup.safe_after <= now()
                  AND (cleanup.claim_expires_at IS NULL OR cleanup.claim_expires_at <= now())
                  AND NOT EXISTS (
                      SELECT 1
                      FROM notification_delivery_outbox outbox
                      WHERE outbox.notification_id = cleanup.notification_id
                        AND outbox.generation = cleanup.generation
                        AND outbox.prepared_at IS NULL
                  )
                ORDER BY cleanup.safe_after, cleanup.created_at, cleanup.notification_id, cleanup.user_id
                FOR UPDATE OF cleanup SKIP LOCKED
                LIMIT 1
            )
            UPDATE notification_digest_receipt_cleanup cleanup
            SET claim_token = $1,
                claim_expires_at = $2,
                attempt_count = cleanup.attempt_count + 1,
                updated_at = now()
            FROM candidate
            WHERE cleanup.notification_id = candidate.notification_id
              AND cleanup.user_id = candidate.user_id
              AND cleanup.generation = candidate.generation
            RETURNING
                cleanup.notification_id,
                cleanup.user_id,
                cleanup.generation,
                cleanup.attempt_count,
                cleanup.created_at AS "created_at!"
            "#,
            claim_token_uuid,
            lease.expires_at,
        )
        .fetch_optional(&mut *tx)
        .await?;
        tx.commit().await?;

        claimed
            .map(|claimed| {
                Ok(ClaimedDigestReceiptCleanup {
                    notification_id: claimed.notification_id,
                    generation: claimed.generation,
                    user_id: MacroUserIdStr::parse_from_str(&claimed.user_id)
                        .map(CowLike::into_owned)
                        .map_err(|error| rootcause::report!(error))?,
                    claim_token,
                    attempt_count: claimed.attempt_count,
                    pending_since: claimed.created_at,
                })
            })
            .transpose()
    }

    async fn complete_digest_receipt_cleanup(
        &self,
        notification_id: Uuid,
        user_id: MacroUserIdStr<'_>,
        generation: Uuid,
        claim_token: DeliveryClaimToken,
    ) -> Result<bool, Report> {
        let deleted = sqlx::query_scalar!(
            r#"
            DELETE FROM notification_digest_receipt_cleanup
            WHERE notification_id = $1
              AND user_id = $2
              AND generation = $3
              AND claim_token = $4
              AND claim_expires_at > now()
            RETURNING notification_id
            "#,
            notification_id,
            user_id.as_ref(),
            generation,
            claim_token.into_uuid(),
        )
        .fetch_optional(&self.db)
        .await?
        .is_some();
        Ok(deleted)
    }

    async fn release_digest_receipt_cleanup(
        &self,
        notification_id: Uuid,
        user_id: MacroUserIdStr<'_>,
        generation: Uuid,
        claim_token: DeliveryClaimToken,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE notification_digest_receipt_cleanup
            SET claim_token = NULL,
                claim_expires_at = NULL,
                safe_after = now() + make_interval(
                    secs => LEAST(300, power(2, LEAST(attempt_count, 8))::integer)
                ),
                updated_at = now()
            WHERE notification_id = $1
              AND user_id = $2
              AND generation = $3
              AND claim_token = $4
            "#,
            notification_id,
            user_id.as_ref(),
            generation,
            claim_token.into_uuid(),
        )
        .execute(&self.db)
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

    async fn create_notification<'a, T: Serialize + Send + Sync>(
        &self,
        request: SendNotificationRequestBuilder<'a, TaggedContent<T>>,
        notification_id: Uuid,
        service_name: &str,
        apns_collapse_key: Option<&str>,
    ) -> Result<Option<Vec<UserNotificationRow<Arc<T>>>>, Report> {
        self.db
            .create_notification(request, notification_id, service_name, apns_collapse_key)
            .await
    }

    async fn update_sent_status<'a>(
        &self,
        notification_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<(), Report> {
        self.db.update_sent_status(notification_id, user_ids).await
    }

    async fn mark_notifications_seen(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        self.db
            .mark_notifications_seen(&user_id, notification_ids)
            .await
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        self.db
            .mark_notifications_done(user_id, notification_ids, done)
            .await
    }

    async fn get_notification_ids_for_entities(
        &self,
        user_id: MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
    ) -> Result<Vec<Uuid>, Report> {
        self.db
            .get_notification_ids_for_entities(&user_id, entities)
            .await
    }

    async fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> Result<Vec<NotificationIdAndCollapseKey>, Report> {
        self.db.get_basic_notifications(notification_ids).await
    }

    async fn get_digest_eligible_notification_ids(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, Report> {
        self.db
            .get_digest_eligible_notification_ids(&user_id, notification_ids)
            .await
    }

    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        self.db
            .get_user_notifications(user_id, limit, cursor, filters)
            .await
    }

    async fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        event_item_ids: &[Uuid],
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        self.db
            .get_user_notifications_by_event_item_ids(
                user_id,
                event_item_ids,
                limit,
                cursor,
                filters,
            )
            .await
    }

    async fn get_entity_notifications_batch(
        &self,
        user_id: MacroUserIdStr<'_>,
        entities: Vec<Entity<'static>>,
    ) -> Result<HashMap<Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>, Report> {
        self.db
            .get_entity_notifications_batch(user_id, entities)
            .await
    }

    async fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<Option<UserNotificationRow<T>>, Report> {
        self.db
            .get_user_notification_by_id(user_id, notification_id)
            .await
    }

    async fn delete_user_notification(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_id: Uuid,
    ) -> Result<(), Report> {
        self.db
            .delete_user_notification(user_id, notification_id)
            .await
    }

    async fn bulk_delete_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> Result<(), Report> {
        self.db
            .bulk_delete_user_notifications(user_id, notification_ids)
            .await
    }

    async fn delete_all_user_notifications(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<(), Report> {
        self.db.delete_all_user_notifications(user_id).await
    }

    async fn get_device_endpoint(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<Option<String>, Report> {
        self.db.get_device_endpoint(device_token, device_type).await
    }

    async fn upsert_device(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_endpoint: &str,
        device_type: &DeviceType,
    ) -> Result<(), Report> {
        self.db
            .upsert_device(user_id, device_token, device_endpoint, device_type)
            .await
    }

    async fn delete_user_devices_by_token(
        &self,
        user_id: MacroUserIdStr<'_>,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<Vec<String>, Report> {
        self.db
            .delete_user_devices_by_token(user_id, device_token, device_type)
            .await
    }

    async fn delete_stale_devices_by_token(
        &self,
        device_token: &str,
        device_type: &DeviceType,
        active_endpoint: &str,
    ) -> Result<Vec<String>, Report> {
        self.db
            .delete_stale_devices_by_token(device_token, device_type, active_endpoint)
            .await
    }

    async fn delete_device_by_endpoint(&self, endpoint_arn: &str) -> Result<(), Report> {
        self.db.delete_by_endpoint(endpoint_arn).await
    }

    async fn get_users_with_type_disabled<'a>(
        &self,
        notification_event_type: &str,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.db
            .get_users_with_type_disabled(notification_event_type, user_ids)
            .await
    }

    async fn get_disabled_notification_types(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<DisabledNotificationType>, Report> {
        self.db.get_disabled_notification_types(user_id).await
    }

    async fn disable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> Result<(), Report> {
        self.db
            .disable_notification_type(user_id, notification_event_type)
            .await
    }

    async fn enable_notification_type(
        &self,
        user_id: MacroUserIdStr<'_>,
        notification_event_type: &str,
    ) -> Result<(), Report> {
        self.db
            .enable_notification_type(user_id, notification_event_type)
            .await
    }
}
