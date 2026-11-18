//! The entities a viewer's unread notifications are filed under, for
//! counting unread rows in their notifications inbox without paging it.
//!
//! Nothing here is gated or filtered: the caller reads the entities it gets
//! back through the attention candidate query, which is. This only finds
//! where to look, in work bounded by `limit` and never by the size of the
//! viewer's history.

use std::{collections::HashSet, str::FromStr};

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use sqlx::PgPool;

use crate::outbound::pg_soup_repo::{candidate_gates::UUID_PATTERN, type_err};

#[cfg(test)]
mod test;

/// Up to `limit` entities of each of `types` that `user_id` holds an unseen
/// notification on, and the email threads with unread mail among the
/// viewer's `limit` newest pending mail notifications.
///
/// Mail is unread while its thread is, whatever state its notifications are
/// in, so an unread thread whose notifications were all seen is found by the
/// second read. One further back than `limit` pending mail notifications is
/// not found.
#[tracing::instrument(err, skip(db, user_id, types), fields(types = types.len()))]
pub(super) async fn attention_unread_entities(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    types: &[EntityType],
    limit: u16,
) -> Result<Vec<Entity<'static>>, sqlx::Error> {
    let type_names: Vec<String> = types
        .iter()
        .map(|entity_type| <&'static str>::from(*entity_type).to_string())
        .collect();

    // Both reads cost what `limit` allows however much the viewer holds, but
    // they run for every signed-in viewer, so a plan gone wrong must not run
    // on.
    let mut transaction = db.begin().await?;
    sqlx::query!("SET LOCAL statement_timeout = '5s'")
        .execute(&mut *transaction)
        .await?;

    // One index probe per entity: each step asks idx_user_notification_user_unseen
    // for the next entity id after the last one found, so an entity with
    // thousands of unseen notifications is read once.
    let unseen = sqlx::query!(
        r#"
        SELECT kind.entity_type AS "entity_type!", found.entity_id AS "entity_id!"
        FROM unnest($2::text[]) AS kind(entity_type)
        CROSS JOIN LATERAL (
            WITH RECURSIVE walk AS (
                (
                    SELECT un.event_item_id AS entity_id, 1 AS position
                    FROM user_notification un
                    WHERE un.user_id = $1
                    AND un.deleted_at IS NULL
                    AND un.state = 'unseen'
                    AND un.event_item_type = kind.entity_type
                    ORDER BY un.event_item_id
                    LIMIT 1
                )
                UNION ALL
                SELECT next.entity_id, walk.position + 1
                FROM walk
                CROSS JOIN LATERAL (
                    SELECT un.event_item_id AS entity_id
                    FROM user_notification un
                    WHERE un.user_id = $1
                    AND un.deleted_at IS NULL
                    AND un.state = 'unseen'
                    AND un.event_item_type = kind.entity_type
                    AND un.event_item_id > walk.entity_id
                    ORDER BY un.event_item_id
                    LIMIT 1
                ) next
                WHERE walk.position < $3
            )
            SELECT entity_id FROM walk
        ) found
        "#,
        user_id.as_ref(),
        &type_names,
        i32::from(limit),
    )
    .fetch_all(&mut *transaction)
    .await?;

    let unread_mail = if types.contains(&EntityType::EmailThread) {
        // The newest pending mail notifications come straight from
        // idx_user_notification_user_pending_email; each one's thread is
        // then one primary-key lookup, fenced so it stays one: unfenced, the
        // planner may instead hash every unread inbox thread there is. The
        // id is unconstrained text, so a malformed one matches no thread
        // instead of failing the cast.
        sqlx::query_scalar!(
            r#"
            SELECT DISTINCT newest.event_item_id AS "entity_id!"
            FROM (
                SELECT un.event_item_id
                FROM user_notification un
                WHERE un.user_id = $1
                AND un.deleted_at IS NULL
                AND un.state <> 'done'
                AND un.event_item_type = 'email_thread'
                ORDER BY un.created_at DESC
                LIMIT $2
            ) newest
            CROSS JOIN LATERAL (
                SELECT 1
                FROM email_threads et
                WHERE et.id = CASE
                    WHEN newest.event_item_id ~ $3 THEN newest.event_item_id::uuid
                END
                AND et.inbox_visible
                AND NOT et.is_read
                OFFSET 0
            ) unread_thread
            "#,
            user_id.as_ref(),
            i64::from(limit),
            UUID_PATTERN,
        )
        .fetch_all(&mut *transaction)
        .await?
    } else {
        Vec::new()
    };
    transaction.commit().await?;

    let mut seen = HashSet::new();
    let mut entities = Vec::with_capacity(unseen.len() + unread_mail.len());
    let found = unseen
        .into_iter()
        .map(|row| (row.entity_type, row.entity_id))
        .chain(unread_mail.into_iter().map(|id| {
            (
                <&'static str>::from(EntityType::EmailThread).to_string(),
                id,
            )
        }));
    for (entity_type, entity_id) in found {
        let entity = EntityType::from_str(&entity_type)
            .map_err(type_err)?
            .with_entity_string(entity_id);
        if seen.insert(entity.clone()) {
            entities.push(entity);
        }
    }
    Ok(entities)
}
