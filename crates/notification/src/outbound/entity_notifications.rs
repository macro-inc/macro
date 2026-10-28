//! Filtered notification edges, limited independently for every requested entity.
//! The primary, secondary and message-id candidate paths each have their own
//! index; the message-id path's `COALESCE` must match `idx_notification_message_id`.
//! Keep lateral ownership lookups fenced with `OFFSET 0`: otherwise PostgreSQL
//! may flatten the joins and rescan the viewer's full history for every entity.
//! The large-history generic-plan regression guards this join order.

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
    let limit = i64::from(query.limit);
    let rows = sqlx::query_file!(
        "src/outbound/entity_notifications/query.sql",
        user_id.as_ref(),
        &ids,
        &types,
        &query.states as _,
        &query.event_types,
        limit,
        query.top_level_messages_only,
        query.channel_feed_only,
        NotificationState::ACTIVE as _,
    )
    .fetch_all(pool)
    .await?;

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
