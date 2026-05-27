#[cfg(test)]
mod tests;

use crate::domain::models::NotificationSortRequest;
use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_soup::{item::SoupItem, notification::SoupNotification};
use sqlx::{PgPool, Postgres, QueryBuilder};
use std::str::FromStr;
use uuid::Uuid;

type NotificationRow = (
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
    limit: i64,
    cursor_id: Option<Uuid>,
    cursor_timestamp: Option<DateTime<Utc>>,
}

#[tracing::instrument(err, skip(db, req))]
pub(super) async fn user_notifications(
    db: &PgPool,
    req: NotificationSortRequest<'_>,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let (cursor_id, cursor_timestamp) = req.cursor.vals();
    let rows = build_user_notifications_query(UserNotificationsQueryArgs {
        user_id: req.user_id.as_ref(),
        limit: req.limit as i64,
        cursor_id: cursor_id.copied(),
        cursor_timestamp: cursor_timestamp.copied(),
    })
    .build_query_as::<NotificationRow>()
    .fetch_all(db)
    .await?;

    let mut notifications = Vec::with_capacity(rows.len());
    for row in rows {
        if let Some(notification) = row_to_notification(row) {
            notifications.push(SoupItem::Notification(Box::new(notification)));
        }
    }

    Ok(notifications)
}

fn build_user_notifications_query<'a>(
    args: UserNotificationsQueryArgs<'a>,
) -> QueryBuilder<'a, Postgres> {
    let mut builder = QueryBuilder::new(
        r#"
            SELECT
                un.user_id AS owner_id,
                un.notification_id,
                n.event_item_id,
                n.event_item_type,
                un.sent,
                un.done,
                un.created_at::timestamptz AS created_at,
                un.seen_at::timestamptz AS viewed_at,
                un.created_at::timestamptz AS updated_at,
                un.deleted_at::timestamptz AS deleted_at,
                COALESCE(n.metadata, '{}'::jsonb) AS notification_metadata,
                n.notification_event_type,
                n.sender_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.user_id = "#,
    );
    builder.push_bind(args.user_id);
    builder.push(" AND un.deleted_at IS NULL AND un.done = false");
    builder.push(
        " AND n.event_item_type IN ('document', 'chat', 'project', 'email_thread', 'channel', 'call')",
    );

    if let (Some(cursor_timestamp), Some(cursor_id)) = (args.cursor_timestamp, args.cursor_id) {
        builder.push(" AND (un.created_at::timestamptz, un.notification_id) < (");
        builder.push_bind(cursor_timestamp);
        builder.push(", ");
        builder.push_bind(cursor_id);
        builder.push(")");
    }

    builder.push(" ORDER BY un.created_at DESC, un.notification_id DESC LIMIT ");
    builder.push_bind(args.limit);

    builder
}

fn row_to_notification(row: NotificationRow) -> Option<SoupNotification> {
    let (
        owner_id,
        notification_id,
        source_entity_id,
        source_entity_type,
        sent,
        done,
        created_at,
        viewed_at,
        updated_at,
        deleted_at,
        metadata,
        event_type,
        sender_id,
    ) = row;

    let source_entity_type = match EntityType::from_str(&source_entity_type) {
        Ok(entity_type) => entity_type,
        Err(e) => {
            tracing::warn!(
                ?notification_id,
                error = ?e,
                "skipping notification with invalid source entity type"
            );
            return None;
        }
    };

    let owner_id = match MacroUserIdStr::parse_from_str(&owner_id).map(CowLike::into_owned) {
        Ok(owner_id) => owner_id,
        Err(e) => {
            tracing::warn!(
                ?notification_id,
                error = ?e,
                "skipping notification with invalid owner id"
            );
            return None;
        }
    };

    let sender_id = match sender_id
        .map(|id| MacroUserIdStr::parse_from_str(&id).map(CowLike::into_owned))
        .transpose()
    {
        Ok(sender_id) => sender_id,
        Err(e) => {
            tracing::warn!(
                ?notification_id,
                error = ?e,
                "skipping notification with invalid sender id"
            );
            return None;
        }
    };

    Some(SoupNotification {
        id: notification_id,
        owner_id,
        event_type,
        source_entity_type,
        source_entity_id,
        sent,
        done,
        created_at,
        viewed_at,
        updated_at,
        deleted_at,
        metadata,
        sender_id,
        source: None,
    })
}
