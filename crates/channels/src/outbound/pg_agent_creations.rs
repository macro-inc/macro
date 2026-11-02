//! Postgres adapter answering what a bot created for a person's request,
//! from the thread's messages and the activity log.

use crate::domain::{models::ReferencedShareItem, ports::AgentCreations};
use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Reads channel requests and bots' recorded creations from Postgres.
#[derive(Clone)]
pub struct PgAgentCreations {
    pool: PgPool,
}

impl PgAgentCreations {
    /// Create the adapter over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AgentCreations for PgAgentCreations {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self, person), err)]
    async fn request_sent_at(
        &self,
        thread_root: Uuid,
        person: &MacroUserIdStr<'static>,
        before: DateTime<Utc>,
    ) -> Result<Option<DateTime<Utc>>, Self::Err> {
        // The root by primary key, replies by the (thread_id, created_at) index.
        sqlx::query_scalar!(
            r#"
            SELECT max(created_at) AS "sent_at"
            FROM (
                SELECT created_at
                FROM comms_messages
                WHERE id = $1 AND sender_id = $2 AND created_at < $3
                UNION ALL
                SELECT created_at
                FROM comms_messages
                WHERE thread_id = $1 AND sender_id = $2 AND created_at < $3
                  AND deleted_at IS NULL
            ) request
            "#,
            thread_root,
            person.as_ref(),
            before,
        )
        .fetch_one(&self.pool)
        .await
    }

    #[tracing::instrument(skip(self, person, items), fields(items = items.len()), err)]
    async fn created_since(
        &self,
        bot: BotId,
        person: &MacroUserIdStr<'static>,
        since: DateTime<Utc>,
        items: Vec<ReferencedShareItem>,
    ) -> Result<Vec<ReferencedShareItem>, Self::Err> {
        if items.is_empty() {
            return Ok(items);
        }
        let entity_types: Vec<String> = items
            .iter()
            // activity_events stores the same entity type names.
            .map(|item| item.entity_type().as_str().to_owned())
            .collect();
        let entity_ids: Vec<String> = items
            .iter()
            .map(|item| item.entity_id().to_owned())
            .collect();
        let actor = bot.into_storage_id();
        // One idx_activity_events_entity_action_timeline probe per linked item.
        let created = sqlx::query!(
            r#"
            SELECT item.entity_type AS "entity_type!", item.entity_id AS "entity_id!"
            FROM UNNEST($1::text[], $2::text[]) AS item(entity_type, entity_id)
            WHERE EXISTS (
                SELECT 1
                FROM activity_events event
                WHERE event.entity_type = item.entity_type
                  AND event.entity_id = item.entity_id
                  AND event.action = 'created'
                  AND event.actor_id = $3
                  AND event.subject_id = $4
                  AND event.occurred_at >= $5
            )
            "#,
            &entity_types,
            &entity_ids,
            actor.as_ref(),
            person.as_ref(),
            since,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(items
            .into_iter()
            .filter(|item| {
                created.iter().any(|row| {
                    row.entity_type == item.entity_type().as_str()
                        && row.entity_id == item.entity_id()
                })
            })
            .collect())
    }
}
