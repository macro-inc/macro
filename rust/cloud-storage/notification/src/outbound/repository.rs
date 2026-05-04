//! Database repository adapter for notifications.

#[cfg(test)]
mod test;

use crate::domain::models::device::DeviceType;
use crate::domain::models::request::NotificationListFilters;
use crate::domain::models::{
    DeviceEndpoint, DisabledNotificationType, NotificationIdAndCollapseKey,
    SendNotificationRequestBuilder, TaggedContent, UserNotificationRow,
};
use crate::domain::ports::NotificationRepository;
use crate::outbound::device_registration::DeviceRegistrationDbOps;
use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_pagination::{CreatedAt, Query};
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
    bool,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    serde_json::Value,
    String,
    Option<String>,
);

struct UserNotificationsQueryArgs<'a> {
    user_id: &'a str,
    event_item_ids: Option<&'a [String]>,
    limit: i64,
    cursor_id: Option<Uuid>,
    cursor_timestamp: Option<DateTime<Utc>>,
    filters: &'a NotificationListFilters,
    include_types: &'a [String],
    entity_tokens: &'a [String],
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
        include_types,
        entity_tokens,
    } = args;

    let mut builder = QueryBuilder::new(
        r#"
            SELECT
                un.user_id as owner_id,
                un.notification_id,
                n.event_item_id,
                n.event_item_type,
                un.sent,
                un.done,
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
    push_include_types_filter(&mut builder, include_types);
    push_entities_filter(&mut builder, entity_tokens);
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

    if let Some(done) = filters.done {
        builder.push(" AND un.done = ");
        builder.push_bind(done);
    }

    if let Some(seen) = filters.seen {
        builder.push(" AND (un.seen_at IS NOT NULL) = ");
        builder.push_bind(seen);
    }
}

fn push_include_types_filter(builder: &mut QueryBuilder<'_, Postgres>, include_types: &[String]) {
    if !include_types.is_empty() {
        builder.push(" AND (");
        let mut needs_or = false;
        for clause in [
            include_types
                .iter()
                .any(|t| t == "email")
                .then_some("n.event_item_type = 'email_thread'"),
            include_types.iter().any(|t| t == "message").then_some(
                r#"(
                    n.notification_event_type IN ('channel_mention', 'channel_message_reply', 'channel_message_send')
                    OR n.metadata ? 'messageId'
                    OR n.metadata ? 'message_id'
                )"#,
            ),
            include_types
                .iter()
                .any(|t| t == "channel")
                .then_some("n.event_item_type = 'channel'"),
            include_types.iter().any(|t| t == "document").then_some(
                "n.event_item_type = 'document' AND COALESCE(n.metadata->>'subType', n.metadata->>'sub_type', '') <> 'task'",
            ),
            include_types.iter().any(|t| t == "task").then_some(
                "n.event_item_type = 'document' AND COALESCE(n.metadata->>'subType', n.metadata->>'sub_type', '') = 'task'",
            ),
            include_types
                .iter()
                .any(|t| t == "project")
                .then_some("n.event_item_type = 'project'"),
            include_types
                .iter()
                .any(|t| t == "chat")
                .then_some("n.event_item_type = 'chat'"),
            include_types
                .iter()
                .any(|t| t == "call")
                .then_some("n.event_item_type = 'call'"),
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

fn push_entities_filter<'a>(builder: &mut QueryBuilder<'a, Postgres>, entity_tokens: &'a [String]) {
    if !entity_tokens.is_empty() {
        builder.push(" AND (");

        builder.push("(n.event_item_type = 'email_thread' AND 'email:' || n.event_item_id = ANY(");
        builder.push_bind(entity_tokens);
        builder.push(")) OR ");

        builder.push("(n.event_item_type = 'channel' AND 'channel:' || n.event_item_id = ANY(");
        builder.push_bind(entity_tokens);
        builder.push(")) OR ");

        builder.push("(n.event_item_type = 'document' AND 'document:' || n.event_item_id = ANY(");
        builder.push_bind(entity_tokens);
        builder.push(")) OR ");

        builder.push("(n.event_item_type = 'document' AND COALESCE(n.metadata->>'subType', n.metadata->>'sub_type', '') = 'task' AND 'task:' || n.event_item_id = ANY(");
        builder.push_bind(entity_tokens);
        builder.push(")) OR ");

        builder.push("(n.event_item_type = 'project' AND 'project:' || n.event_item_id = ANY(");
        builder.push_bind(entity_tokens);
        builder.push(")) OR ");

        builder.push("(n.event_item_type = 'chat' AND 'chat:' || n.event_item_id = ANY(");
        builder.push_bind(entity_tokens);
        builder.push(")) OR ");

        builder.push("(n.event_item_type = 'call' AND 'call:' || n.event_item_id = ANY(");
        builder.push_bind(entity_tokens);
        builder.push(")) OR ");

        builder.push("('message:' || COALESCE(n.metadata->>'messageId', n.metadata->>'message_id', '') = ANY(");
        builder.push_bind(entity_tokens);
        builder.push("))");

        builder.push(")");
    }
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
/// for compile-time checked sqlx queries.
#[derive(Debug, sqlx::Type)]
#[sqlx(
    type_name = "notification_device_type_option",
    rename_all = "lowercase"
)]
enum DbDeviceType {
    Ios,
    Android,
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

    /// Mark notifications as seen for a user.
    fn mark_notifications_seen(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Mark notifications as done or undone for a user.
    fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> impl std::future::Future<Output = Result<(), Report>> + Send;

    /// Get basic notification data (collapse keys) for push clearing.
    fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> impl std::future::Future<Output = Result<Vec<NotificationIdAndCollapseKey>, Report>> + Send;

    /// Get a user's non-deleted notifications with cursor-based pagination.
    ///
    /// The metadata JSON column is deserialized into `T`. `filters` controls done/seen status.
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
        let metadata = serde_json::to_value(&request.notification.content)?;

        let mut tx = self.begin().await?;

        let sender_id = request.sender_id.as_ref().map(|id| id.to_string());
        let typename = request.notification.tag.as_ref();

        // Insert notification
        let result = sqlx::query!(
            r#"
            INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id, apns_collapse_key)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO NOTHING
            "#,
            notification_id,
            typename,
            request.notification_entity.entity_id.as_ref(),
            entity_type,
            service_name,
            metadata as serde_json::Value,
            sender_id,
            apns_collapse_key
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
                done: false,
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
    ) -> Result<(), Report> {
        let user_id_str = user_id.to_string();

        sqlx::query!(
            r#"
            UPDATE user_notification
            SET seen_at = NOW()
            WHERE user_id = $1 AND notification_id = ANY($2)
            "#,
            user_id_str,
            notification_ids
        )
        .execute(self)
        .await?;

        Ok(())
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<(), Report> {
        let user_id_str = user_id.to_string();

        sqlx::query!(
            r#"
            UPDATE user_notification
            SET done = $3
            WHERE user_id = $1 AND notification_id = ANY($2)
            "#,
            user_id_str,
            notification_ids,
            done
        )
        .execute(self)
        .await?;

        Ok(())
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

    async fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        user_id: MacroUserIdStr<'_>,
        limit: u32,
        cursor: Query<Uuid, CreatedAt, ()>,
        filters: NotificationListFilters,
    ) -> Result<Vec<UserNotificationRow<T>>, Report> {
        let query_limit = limit as i64;
        let (cursor_id, cursor_timestamp) = cursor.vals();
        let include_types = filters.include_type_tokens();
        let entity_tokens = filters.entity_tokens();

        let rows = build_user_notifications_query(UserNotificationsQueryArgs {
            user_id: user_id.as_ref(),
            event_item_ids: None,
            limit: query_limit,
            cursor_id: cursor_id.copied(),
            cursor_timestamp: cursor_timestamp.copied(),
            filters: &filters,
            include_types: &include_types,
            entity_tokens: &entity_tokens,
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
                done,
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
                    tracing::warn!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let sender_id = match sender_id
                .map(|s| MacroUserIdStr::parse_from_str(&s).map(CowLike::into_owned))
                .transpose()
            {
                Ok(sender_id) => sender_id,
                Err(e) => {
                    tracing::warn!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let owner_id = match MacroUserIdStr::parse_from_str(&owner_id).map(CowLike::into_owned)
            {
                Ok(owner_id) => owner_id,
                Err(e) => {
                    tracing::warn!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let notification_metadata = match serde_json::from_value::<T>(notification_metadata) {
                Ok(metadata) => metadata,
                Err(e) => {
                    tracing::warn!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };

            notifications.push(UserNotificationRow {
                owner_id,
                notification_id,
                notification_event_type,
                entity,
                sent,
                done,
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
        let include_types = filters.include_type_tokens();
        let entity_tokens = filters.entity_tokens();

        let rows = build_user_notifications_query(UserNotificationsQueryArgs {
            user_id: user_id.as_ref(),
            event_item_ids: Some(&event_item_ids),
            limit: query_limit,
            cursor_id: cursor_id.copied(),
            cursor_timestamp: cursor_timestamp.copied(),
            filters: &filters,
            include_types: &include_types,
            entity_tokens: &entity_tokens,
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
                done,
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
                    tracing::warn!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let sender_id = match sender_id
                .map(|s| MacroUserIdStr::parse_from_str(&s).map(CowLike::into_owned))
                .transpose()
            {
                Ok(sender_id) => sender_id,
                Err(e) => {
                    tracing::warn!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let owner_id = match MacroUserIdStr::parse_from_str(&owner_id).map(CowLike::into_owned)
            {
                Ok(owner_id) => owner_id,
                Err(e) => {
                    tracing::warn!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };
            let notification_metadata = match serde_json::from_value::<T>(notification_metadata) {
                Ok(metadata) => metadata,
                Err(e) => {
                    tracing::warn!(?notification_id, error = ?e, "skipping invalid notification");
                    continue;
                }
            };

            notifications.push(UserNotificationRow {
                owner_id,
                notification_id,
                notification_event_type,
                entity,
                sent,
                done,
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
                un.done,
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
            done: row.done,
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
    ) -> Result<(), Report> {
        self.db
            .mark_notifications_seen(&user_id, notification_ids)
            .await
    }

    async fn mark_notifications_done(
        &self,
        user_id: &MacroUserIdStr<'_>,
        notification_ids: &[Uuid],
        done: bool,
    ) -> Result<(), Report> {
        self.db
            .mark_notifications_done(user_id, notification_ids, done)
            .await
    }

    async fn get_basic_notifications(
        &self,
        notification_ids: &[Uuid],
    ) -> Result<Vec<NotificationIdAndCollapseKey>, Report> {
        self.db.get_basic_notifications(notification_ids).await
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

    async fn get_device_endpoint(&self, device_token: &str) -> Result<Option<String>, Report> {
        self.db.get_device_endpoint(device_token).await
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

    async fn delete_device_by_token(
        &self,
        device_token: &str,
        device_type: &DeviceType,
    ) -> Result<String, Report> {
        self.db.delete_by_token(device_token, device_type).await
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
