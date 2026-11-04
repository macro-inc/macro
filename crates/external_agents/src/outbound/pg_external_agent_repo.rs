//! External agents and their inboxes in MacroDB.

#[cfg(test)]
mod test;

use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::MessageParent;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::ExternalAgentEvent;
use crate::domain::ports::{ExternalAgentError, ExternalAgentRepo, ExternalAgentRow, Result};

/// `external_agents` and `external_agent_events` over MacroDB.
#[derive(Clone)]
pub struct PgExternalAgentRepo {
    pool: PgPool,
}

impl PgExternalAgentRepo {
    /// Wrap a MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn internal(error: sqlx::Error) -> ExternalAgentError {
    ExternalAgentError::Internal(rootcause::report!(error).into())
}

struct EventRow {
    id: Uuid,
    bot_id: Uuid,
    kind: String,
    parent_type: String,
    parent_id: String,
    message_id: Uuid,
    message_thread_id: Option<Uuid>,
    reply_thread_id: Option<Uuid>,
    sender_id: String,
    invoking_user_id: String,
    content: String,
    message_created_at: DateTime<Utc>,
}

impl TryFrom<EventRow> for ExternalAgentEvent {
    type Error = ExternalAgentError;

    fn try_from(row: EventRow) -> Result<Self> {
        let corrupt = |what: &str| {
            ExternalAgentError::Internal(rootcause::report!(
                "external agent event {} has an invalid {what}",
                row.id
            ))
        };
        Ok(Self {
            id: row.id,
            bot_id: BotId::new_from_uuid(row.bot_id),
            kind: row.kind.parse().map_err(|_| corrupt("kind"))?,
            parent: MessageParent::parse(&row.parent_type, &row.parent_id)
                .map_err(|_| corrupt("conversation"))?,
            message_id: row.message_id,
            message_thread_id: row.message_thread_id,
            reply_thread_id: row.reply_thread_id,
            sender_id: row.sender_id,
            invoking_user: MacroUserIdStr::try_from(row.invoking_user_id)
                .map_err(|_| corrupt("invoking user"))?,
            content: row.content,
            message_created_at: row.message_created_at,
        })
    }
}

impl ExternalAgentRepo for PgExternalAgentRepo {
    #[tracing::instrument(skip(self), err)]
    async fn register(&self, bot_id: BotId, webhook_id: Option<&str>) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO external_agents (bot_id, webhook_id)
            VALUES ($1, $2)
            ON CONFLICT (bot_id) DO NOTHING
            "#,
            bot_id.as_uuid(),
            webhook_id,
        )
        .execute(&self.pool)
        .await
        .map_err(internal)?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_webhook(&self, bot_id: BotId, webhook_id: Option<&str>) -> Result<()> {
        let updated = sqlx::query!(
            "UPDATE external_agents SET webhook_id = $2 WHERE bot_id = $1",
            bot_id.as_uuid(),
            webhook_id,
        )
        .execute(&self.pool)
        .await
        .map_err(internal)?;
        if updated.rows_affected() == 0 {
            return Err(ExternalAgentError::NotFound);
        }
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get(&self, bot_ids: &[BotId]) -> Result<Vec<ExternalAgentRow>> {
        let ids: Vec<Uuid> = bot_ids.iter().map(|id| id.as_uuid()).collect();
        let rows = sqlx::query!(
            r#"
            SELECT bot_id, webhook_id
            FROM external_agents
            WHERE bot_id = ANY($1)
            "#,
            &ids,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(internal)?;
        Ok(rows
            .into_iter()
            .map(|row| ExternalAgentRow {
                bot_id: BotId::new_from_uuid(row.bot_id),
                webhook_id: row.webhook_id,
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove(&self, bot_id: BotId) -> Result<()> {
        sqlx::query!(
            "DELETE FROM external_agents WHERE bot_id = $1",
            bot_id.as_uuid(),
        )
        .execute(&self.pool)
        .await
        .map_err(internal)?;
        Ok(())
    }

    #[tracing::instrument(skip(self, event), fields(bot_id = %event.bot_id), err)]
    async fn record(
        &self,
        event: ExternalAgentEvent,
        trigger_event_id: Uuid,
    ) -> Result<ExternalAgentEvent> {
        let kind: &'static str = event.kind.into();
        let row = sqlx::query_as!(
            EventRow,
            r#"
            WITH inserted AS (
                INSERT INTO external_agent_events (
                    id, bot_id, trigger_event_id, kind, parent_type, parent_id,
                    message_id, message_thread_id, reply_thread_id, sender_id,
                    invoking_user_id, content, message_created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (bot_id, trigger_event_id) DO NOTHING
                RETURNING
                    id, bot_id, kind, parent_type, parent_id, message_id,
                    message_thread_id, reply_thread_id, sender_id,
                    invoking_user_id, content, message_created_at
            )
            SELECT
                id AS "id!", bot_id AS "bot_id!", kind AS "kind!",
                parent_type AS "parent_type!", parent_id AS "parent_id!",
                message_id AS "message_id!", message_thread_id, reply_thread_id,
                sender_id AS "sender_id!", invoking_user_id AS "invoking_user_id!",
                content AS "content!", message_created_at AS "message_created_at!"
            FROM inserted
            UNION ALL
            SELECT
                id, bot_id, kind, parent_type, parent_id, message_id,
                message_thread_id, reply_thread_id, sender_id,
                invoking_user_id, content, message_created_at
            FROM external_agent_events
            WHERE bot_id = $2 AND trigger_event_id = $3
            LIMIT 1
            "#,
            event.id,
            event.bot_id.as_uuid(),
            trigger_event_id,
            kind,
            event.parent.entity_type(),
            event.parent.entity_id(),
            event.message_id,
            event.message_thread_id,
            event.reply_thread_id,
            event.sender_id,
            event.invoking_user.as_ref(),
            event.content,
            event.message_created_at,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(internal)?;
        row.try_into()
    }

    #[tracing::instrument(skip(self), err)]
    async fn events(
        &self,
        bot_id: BotId,
        after: Option<Uuid>,
        limit: u16,
    ) -> Result<Vec<ExternalAgentEvent>> {
        let rows = sqlx::query_as!(
            EventRow,
            r#"
            SELECT
                id, bot_id, kind, parent_type, parent_id, message_id,
                message_thread_id, reply_thread_id, sender_id,
                invoking_user_id, content, message_created_at
            FROM external_agent_events
            WHERE bot_id = $1 AND ($2::uuid IS NULL OR id > $2)
            ORDER BY id
            LIMIT $3
            "#,
            bot_id.as_uuid(),
            after,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(internal)?;
        rows.into_iter().map(TryInto::try_into).collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn event(&self, bot_id: BotId, event_id: Uuid) -> Result<Option<ExternalAgentEvent>> {
        sqlx::query_as!(
            EventRow,
            r#"
            SELECT
                id, bot_id, kind, parent_type, parent_id, message_id,
                message_thread_id, reply_thread_id, sender_id,
                invoking_user_id, content, message_created_at
            FROM external_agent_events
            WHERE bot_id = $1 AND id = $2
            "#,
            bot_id.as_uuid(),
            event_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(internal)?
        .map(TryInto::try_into)
        .transpose()
    }
}
