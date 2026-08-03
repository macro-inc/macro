//! Postgres implementation of the agent session and agent session log
//! repositories.

#[cfg(test)]
mod test;

use crate::domain::error::Result;
use crate::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, Message, SessionStatus, UninitializedSession,
};
use crate::domain::ports::{AgentSessionLogRepo, AgentSessionRepo};
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use anyhow::Context;
use bots::domain::models::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;

/// Postgres implementation of [`AgentSessionRepo`] and [`AgentSessionLogRepo`].
#[derive(Debug, Clone)]
pub struct PgAgentSessionRepo {
    pool: PgPool,
}

impl PgAgentSessionRepo {
    /// Create a Postgres agent session repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// The wire name for a [`SessionStatus`] and, for `SessionStatus::Event`, the
/// system event name to store alongside it.
fn status_columns(status: &SessionStatus) -> (&'static str, Option<String>) {
    match status {
        SessionStatus::NoMessages => ("no_messages", None),
        SessionStatus::Event(event) => ("event", Some(event.as_str().to_owned())),
        SessionStatus::Disconnected => ("disconnected", None),
    }
}

/// Reverse of [`status_columns`]. Event names round-trip through
/// [`SystemEvent`]'s own (de)serialization rather than duplicating its wire
/// format here.
fn parse_status(status: &str, event_name: Option<String>) -> anyhow::Result<SessionStatus> {
    match status {
        "no_messages" => Ok(SessionStatus::NoMessages),
        "disconnected" => Ok(SessionStatus::Disconnected),
        "event" => {
            let name = event_name
                .context("agent_session row has status = 'event' with no status_event_name")?;
            let event: SystemEvent = serde_json::from_value(serde_json::Value::String(name))
                .context("failed to parse agent_session status_event_name")?;
            Ok(SessionStatus::Event(event))
        }
        other => anyhow::bail!("unknown agent_session status {other:?}"),
    }
}

/// The wire direction and JSON payload for a [`Message`].
fn message_columns(message: &Message) -> anyhow::Result<(&'static str, serde_json::Value)> {
    match message {
        Message::ToServer(message) => Ok(("to_server", serde_json::to_value(message)?)),
        Message::ToRuntime(message) => Ok(("to_runtime", serde_json::to_value(message)?)),
    }
}

/// Reverse of [`message_columns`].
fn parse_message(direction: &str, content: serde_json::Value) -> anyhow::Result<Message> {
    match direction {
        "to_server" => Ok(Message::ToServer(
            serde_json::from_value::<ToServerMessage>(content)?,
        )),
        "to_runtime" => Ok(Message::ToRuntime(serde_json::from_value::<
            ToRuntimeMessage,
        >(content)?)),
        other => anyhow::bail!("unknown agent_session_log direction {other:?}"),
    }
}

struct AgentSessionRow {
    id: Uuid,
    created_from_thread_id: Option<Uuid>,
    thread_id: Uuid,
    bot_id: Uuid,
    model: String,
    harness: String,
    repo_url: String,
    acp_session_id: Option<String>,
    status: String,
    status_event_name: Option<String>,
    created_at: DateTime<Utc>,
    modified_at: DateTime<Utc>,
}

impl TryFrom<AgentSessionRow> for AgentSession<AgentSessionId> {
    type Error = anyhow::Error;

    fn try_from(row: AgentSessionRow) -> anyhow::Result<Self> {
        let status = parse_status(&row.status, row.status_event_name)?;
        Ok(Self {
            id: AgentSessionId::new_from_uuid(row.id),
            created_from_thread_id: row.created_from_thread_id,
            thread_id: row.thread_id,
            bot_id: BotId::new_from_uuid(row.bot_id),
            model: row.model,
            harness: row.harness,
            repo_url: row.repo_url,
            acp_session_id: row.acp_session_id,
            status,
            created_at: row.created_at,
            modified_at: row.modified_at,
        })
    }
}

impl AgentSessionRepo for PgAgentSessionRepo {
    async fn create(&self, session: AgentSession<UninitializedSession>) -> Result<AgentSessionId> {
        let id = AgentSessionId::new_from_uuid(macro_uuid::generate_uuid_v7());
        let (status, status_event_name) = status_columns(&session.status);
        sqlx::query!(
            r#"
            INSERT INTO agent_session (
                id, created_from_thread_id, thread_id, bot_id, model, harness,
                repo_url, acp_session_id, status, status_event_name, created_at, modified_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            "#,
            id.as_uuid(),
            session.created_from_thread_id,
            session.thread_id,
            session.bot_id.as_uuid(),
            session.model,
            session.harness,
            session.repo_url,
            session.acp_session_id,
            status,
            status_event_name,
            session.created_at,
            session.modified_at,
        )
        .execute(&self.pool)
        .await
        .context("failed to create agent session")?;

        Ok(id)
    }

    async fn get(&self, id: AgentSessionId) -> Result<AgentSession<AgentSessionId>> {
        let row = sqlx::query_as!(
            AgentSessionRow,
            r#"
            SELECT
                id, created_from_thread_id, thread_id, bot_id, model, harness,
                repo_url, acp_session_id, status, status_event_name, created_at, modified_at
            FROM agent_session
            WHERE id = $1
            "#,
            id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to get agent session")?
        .context("agent session not found")?;

        Ok(row.try_into()?)
    }

    async fn update(&self, session: AgentSession<AgentSessionId>) -> Result<()> {
        let (status, status_event_name) = status_columns(&session.status);
        let result = sqlx::query!(
            r#"
            UPDATE agent_session
            SET created_from_thread_id = $2,
                thread_id = $3,
                bot_id = $4,
                model = $5,
                harness = $6,
                repo_url = $7,
                acp_session_id = $8,
                status = $9,
                status_event_name = $10,
                modified_at = $11
            WHERE id = $1
            "#,
            session.id.as_uuid(),
            session.created_from_thread_id,
            session.thread_id,
            session.bot_id.as_uuid(),
            session.model,
            session.harness,
            session.repo_url,
            session.acp_session_id,
            status,
            status_event_name,
            session.modified_at,
        )
        .execute(&self.pool)
        .await
        .context("failed to update agent session")?;

        if result.rows_affected() == 0 {
            return Err(anyhow::anyhow!("agent session not found").into());
        }

        Ok(())
    }

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        sqlx::query!(r#"DELETE FROM agent_session WHERE id = $1"#, id.as_uuid(),)
            .execute(&self.pool)
            .await
            .context("failed to delete agent session")?;

        Ok(())
    }
}

struct AgentSessionLogRow {
    agent_session_id: Uuid,
    user_id: Option<MacroUserIdStr<'static>>,
    direction: String,
    content: serde_json::Value,
}

impl TryFrom<AgentSessionLogRow> for AgentSessionLog {
    type Error = anyhow::Error;

    fn try_from(row: AgentSessionLogRow) -> anyhow::Result<Self> {
        Ok(Self {
            agent_session_id: AgentSessionId::new_from_uuid(row.agent_session_id),
            user_id: row.user_id,
            content: parse_message(&row.direction, row.content)?,
        })
    }
}

impl AgentSessionLogRepo for PgAgentSessionRepo {
    async fn create(&self, log: AgentSessionLog) -> Result<()> {
        let (direction, content) = message_columns(&log.content)?;
        sqlx::query!(
            r#"
            INSERT INTO agent_session_log (id, agent_session_id, user_id, direction, content)
            VALUES ($1, $2, $3, $4, $5)
            "#,
            macro_uuid::generate_uuid_v7(),
            log.agent_session_id.as_uuid(),
            log.user_id.as_ref().map(|user_id| user_id.as_ref()),
            direction,
            content,
        )
        .execute(&self.pool)
        .await
        .context("failed to create agent session log entry")?;

        Ok(())
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<AgentSessionLog>> {
        let rows = sqlx::query_as!(
            AgentSessionLogRow,
            r#"
            SELECT agent_session_id, user_id AS "user_id: MacroUserIdStr", direction, content
            FROM agent_session_log
            WHERE agent_session_id = $1
            ORDER BY created_at ASC, id ASC
            "#,
            agent_session_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list agent session log entries")?;

        Ok(rows
            .into_iter()
            .map(TryInto::try_into)
            .collect::<anyhow::Result<Vec<_>>>()?)
    }
}
