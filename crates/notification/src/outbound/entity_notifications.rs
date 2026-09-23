//! Filtered notification edges, limited independently for every requested entity.
//! Separate indexed primary/secondary candidate paths keep the legacy JSON
//! message lookup from forcing a metadata scan for ordinary channel requests.

use std::{collections::HashMap, str::FromStr};

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::{Entity, EntityType};
use rootcause::Report;
use sqlx::PgPool;

use crate::domain::models::{
    NotificationState, UserNotificationRow, entity_query::EntityNotificationQuery,
};

pub(super) async fn get_filtered_entity_notifications(
    pool: &PgPool,
    user_id: MacroUserIdStr<'_>,
    entities: Vec<Entity<'static>>,
    query: EntityNotificationQuery,
) -> Result<HashMap<Entity<'static>, Vec<UserNotificationRow<serde_json::Value>>>, Report> {
    query.validate()?;
    let mut result: HashMap<_, Vec<_>> = entities
        .into_iter()
        .map(|entity| (entity, Vec::new()))
        .collect();
    if result.is_empty() || query.states.is_empty() {
        return Ok(result);
    }
    let ids: Vec<_> = result
        .keys()
        .map(|entity| entity.entity_id.to_string())
        .collect();
    let types: Vec<_> = result
        .keys()
        .map(|entity| entity.entity_type.as_ref().to_owned())
        .collect();
    let limit = query.limit.map(i64::from);
    let rows = sqlx::query!(
        r#"
        SELECT requested.entity_id AS "requested_id!",
               requested.entity_type AS "requested_type!",
               matched.notification_id AS "notification_id!",
               matched.event_item_id AS "event_item_id!",
               matched.event_item_type AS "event_item_type!",
               matched.notification_event_type AS "notification_event_type!",
               matched.sent AS "sent!",
               matched.state AS "state!: NotificationState",
               matched.created_at AS "created_at!",
               matched.viewed_at,
               matched.notification_metadata,
               matched.sender_id
        FROM unnest($2::text[], $3::text[]) requested(entity_id, entity_type)
        CROSS JOIN LATERAL (
            SELECT un.notification_id, n.event_item_id, n.event_item_type,
                   n.notification_event_type, un.sent, un.state,
                   un.created_at::timestamptz AS created_at,
                   un.seen_at::timestamptz AS viewed_at,
                   n.metadata AS notification_metadata, n.sender_id
            FROM (
                SELECT n.id FROM notification n
                WHERE n.event_item_id = requested.entity_id AND n.event_item_type = requested.entity_type
                UNION
                SELECT n.id FROM notification n
                WHERE n.secondary_event_item_id = requested.entity_id AND n.secondary_event_item_type = requested.entity_type
                UNION
                SELECT n.id FROM notification n
                WHERE requested.entity_type = 'channel_message'
                  AND COALESCE(n.metadata->>'messageId', n.metadata->>'message_id', '') = requested.entity_id
            ) candidates
            JOIN notification n ON n.id = candidates.id
            JOIN user_notification un ON un.notification_id = n.id
            WHERE un.user_id = $1
              AND un.deleted_at IS NULL
              AND un.state = ANY($4::notification_state[])
              AND (cardinality($5::text[]) = 0 OR n.notification_event_type = ANY($5))
            ORDER BY un.created_at DESC, un.notification_id DESC
            LIMIT $6
        ) matched
        "#,
        user_id.as_ref(), &ids, &types, &query.states as _, &query.event_types, limit,
    ).fetch_all(pool).await?;

    for row in rows {
        let requested =
            EntityType::from_str(&row.requested_type)?.with_entity_string(row.requested_id);
        let mapped = (|| -> Result<_, Report> {
            Ok(UserNotificationRow {
                owner_id: user_id.clone().into_owned(),
                notification_id: row.notification_id,
                notification_event_type: row.notification_event_type,
                entity: EntityType::from_str(&row.event_item_type)?
                    .with_entity_string(row.event_item_id),
                sent: row.sent,
                state: row.state,
                created_at: row.created_at,
                viewed_at: row.viewed_at,
                updated_at: row.created_at,
                deleted_at: None,
                notification_metadata: row.notification_metadata,
                sender_id: row
                    .sender_id
                    .map(|sender| MacroUserIdStr::parse_from_str(&sender).map(CowLike::into_owned))
                    .transpose()?,
            })
        })();
        match mapped {
            Ok(notification) => result.entry(requested).or_default().push(notification),
            Err(error) => {
                tracing::warn!(error = ?error, notification_id = %row.notification_id, "skipping invalid notification")
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod test;
