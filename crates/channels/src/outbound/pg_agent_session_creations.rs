//! Postgres adapter answering what an agent session created, from the
//! session row and the activity log.

use crate::domain::{models::ReferencedShareItem, ports::AgentSessionCreations};
use bot_id::BotId;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Reads agent sessions and their recorded creations from Postgres.
#[derive(Clone)]
pub struct PgAgentSessionCreations {
    pool: PgPool,
}

impl PgAgentSessionCreations {
    /// Create the adapter over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl AgentSessionCreations for PgAgentSessionCreations {
    type Err = sqlx::Error;

    #[tracing::instrument(skip(self), err)]
    async fn session_started_at(
        &self,
        thread_root: Uuid,
        bot: BotId,
    ) -> Result<Option<DateTime<Utc>>, Self::Err> {
        // Served by agent_session_thread_bot_unique (thread_id, bot_id).
        sqlx::query_scalar!(
            r#"
            SELECT created_at
            FROM agent_session
            WHERE thread_id = $1 AND bot_id = $2
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            thread_root,
            bot.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
    }

    #[tracing::instrument(skip(self, items), fields(items = items.len()), err)]
    async fn created_since(
        &self,
        bot: BotId,
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
                  AND event.occurred_at >= $4
            )
            "#,
            &entity_types,
            &entity_ids,
            actor.as_ref(),
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
