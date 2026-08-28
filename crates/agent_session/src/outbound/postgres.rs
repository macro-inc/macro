//! Postgres implementation of the agent session and agent session log
//! repositories, the fold's log source, and the audience a streamed frame is
//! addressed to.

#[cfg(test)]
mod test;

use crate::domain::error::{AgentSessionError, Result};
use crate::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, ChannelSession, CreateAgentSessionParams,
    ExternalSession, Message, SandboxSize, SessionBot, SessionStatus, StoredAgentSessionLog,
};
use crate::domain::ports::{AgentSessionLogRepo, AgentSessionRepo, ExternalSessionRepo};
use crate::outbound::connection_gateway_realtime::SessionAudience;
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use anyhow::Context;
use bots::domain::models::BotId;
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use chrono::{DateTime, Utc};
use entity_access_db_utils::{
    AccessLevel, EntityAccessSourceType, EntityType, delete_entity_access_rows,
    insert_entity_access_row,
};
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
fn status_columns(status: &SessionStatus) -> (&str, Option<String>) {
    let event_name = match status {
        SessionStatus::Event(event) => Some(event.as_str().to_owned()),
        SessionStatus::NoMessages | SessionStatus::Disconnected => None,
    };
    (status.as_ref(), event_name)
}

/// Reverse of [`status_columns`].
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

fn parse_sandbox_size(value: &str) -> anyhow::Result<SandboxSize> {
    value
        .parse()
        .map_err(|_| anyhow::anyhow!("unknown agent_session sandbox_size {value:?}"))
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
    name: String,
    owner_id: String,
    thread_id: Option<Uuid>,
    thread_channel_id: Option<Uuid>,
    originating_message_id: Option<Uuid>,
    bot_id: Uuid,
    model: String,
    harness: String,
    repo_url: Option<String>,
    workspace: String,
    sandbox_size: String,
    instructions: Option<String>,
    acp_session_id: Option<String>,
    external_provider: Option<String>,
    external_id: Option<String>,
    external_name: Option<String>,
    external_url: Option<String>,
    status: String,
    status_event_name: Option<String>,
    created_at: DateTime<Utc>,
    modified_at: DateTime<Utc>,
}

impl TryFrom<AgentSessionRow> for AgentSession {
    type Error = anyhow::Error;

    fn try_from(row: AgentSessionRow) -> anyhow::Result<Self> {
        let status = parse_status(&row.status, row.status_event_name)?;
        Ok(Self {
            id: AgentSessionId::new_from_uuid(row.id),
            name: row.name,
            owner_id: MacroUserIdStr::try_from(row.owner_id)
                .context("agent session has an unparseable owner")?,
            thread_id: row.thread_id,
            thread_channel_id: row.thread_channel_id,
            originating_message_id: row.originating_message_id,
            bot_id: BotId::new_from_uuid(row.bot_id),
            model: row.model,
            harness: row.harness,
            repo_url: row.repo_url,
            workspace: row.workspace,
            sandbox_size: parse_sandbox_size(&row.sandbox_size)?,
            instructions: row.instructions,
            acp_session_id: row.acp_session_id.map(Into::into),
            external: row
                .external_provider
                .zip(row.external_id)
                .map(|(provider, external_id)| ExternalSession {
                    provider,
                    external_id,
                    external_name: row.external_name,
                    external_url: row.external_url,
                }),
            status,
            created_at: row.created_at,
            modified_at: row.modified_at,
        })
    }
}

impl AgentSessionRepo for PgAgentSessionRepo {
    async fn create(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        let CreateAgentSessionParams {
            id,
            owner_id,
            bot_id,
            thread_id,
            originating_message_id,
            model,
            harness,
            repo_url,
            workspace,
            sandbox_size,
            instructions,
            egress_token_hash,
        } = params;

        // The session row and its access grants land together: a crash between
        // the two would leave a session nobody - not even its owner -
        // could open.
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin agent session create")?;

        let (status, status_event_name) = status_columns(&SessionStatus::NoMessages);
        let row = sqlx::query_as!(
            AgentSessionRow,
            r#"
            INSERT INTO agent_session (
                id, owner_id, thread_id, originating_message_id, bot_id, model,
                harness, repo_url, workspace, sandbox_size, instructions,
                acp_session_id, status, status_event_name, egress_token_hash
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING
                id, name, owner_id, thread_id, originating_message_id, bot_id,
                model, harness, repo_url, workspace, sandbox_size, instructions,
                acp_session_id, status,
                status_event_name, created_at, modified_at,
                (SELECT channel_id FROM comms_messages WHERE id = agent_session.thread_id)
                    AS "thread_channel_id?",
                -- A row being created cannot have an external identity yet.
                NULL::TEXT AS "external_provider?", NULL::TEXT AS "external_id?",
                NULL::TEXT AS "external_name?", NULL::TEXT AS "external_url?"
            "#,
            id.as_uuid(),
            owner_id.as_ref(),
            thread_id,
            originating_message_id,
            bot_id.as_uuid(),
            model,
            harness,
            repo_url,
            workspace,
            sandbox_size.as_str(),
            instructions,
            None::<String>,
            status,
            status_event_name,
            egress_token_hash,
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(
            |error| match error.as_database_error().and_then(|e| e.constraint()) {
                Some("agent_session_thread_bot_unique") => AgentSessionError::ThreadSessionExists,
                Some("agent_session_owner_id_fkey") => AgentSessionError::UnknownOwner,
                _ => AgentSessionError::Unknown(
                    anyhow::Error::new(error).context("failed to create agent session"),
                ),
            },
        )?;

        insert_entity_access_row(
            &mut transaction,
            &id.as_uuid(),
            EntityType::AgentSession,
            owner_id.as_ref(),
            EntityAccessSourceType::User,
            AccessLevel::Owner,
        )
        .await
        .context("failed to grant the owner access to the agent session")?;

        // The channel the bot was invoked in can steer the session: the
        // invocation was public there, so that audience is. Read from the
        // message rather than taken from the caller, so the channel is always
        // the one the message actually sits in. A session created without a
        // message - directly, rather than from a channel - is its owner's alone.
        let origin_channel_id = match originating_message_id {
            Some(message_id) => sqlx::query_scalar!(
                "SELECT channel_id FROM comms_messages WHERE id = $1",
                message_id,
            )
            .fetch_optional(&mut *transaction)
            .await
            .context("failed to read the originating message's channel")?,
            None => None,
        };

        if let Some(channel_id) = origin_channel_id {
            insert_entity_access_row(
                &mut transaction,
                &id.as_uuid(),
                EntityType::AgentSession,
                &channel_id.to_string(),
                EntityAccessSourceType::Channel,
                AccessLevel::Edit,
            )
            .await
            .context("failed to grant the originating channel access to the agent session")?;
        }

        transaction
            .commit()
            .await
            .context("commit agent session create")?;

        Ok(row.try_into()?)
    }

    async fn get(&self, id: AgentSessionId) -> Result<AgentSession> {
        let row = sqlx::query_as!(
            AgentSessionRow,
            r#"
            SELECT
                id, name, owner_id, thread_id, originating_message_id, bot_id,
                model, harness, repo_url, workspace, sandbox_size, instructions,
                acp_session_id, status,
                status_event_name, agent_session.created_at, modified_at,
                (SELECT channel_id FROM comms_messages WHERE id = agent_session.thread_id)
                    AS "thread_channel_id?",
                ext.provider AS "external_provider?", ext.external_id AS "external_id?",
                ext.external_name AS "external_name?", ext.external_url AS "external_url?"
            FROM agent_session
            LEFT JOIN external_agent_session AS ext ON ext.agent_session_id = agent_session.id
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

    async fn find_by_egress_token_hash(
        &self,
        egress_token_hash: &str,
    ) -> Result<Option<AgentSession>> {
        // Matched in SQL rather than fetched and compared: the unique partial
        // index on this column does the work, and nothing secret-derived is
        // compared byte by byte in this process.
        let row = sqlx::query_as!(
            AgentSessionRow,
            r#"
            SELECT
                id, name, owner_id, thread_id, originating_message_id, bot_id,
                model, harness, repo_url, workspace, sandbox_size, instructions,
                acp_session_id, status,
                status_event_name, agent_session.created_at, modified_at,
                (SELECT channel_id FROM comms_messages WHERE id = agent_session.thread_id)
                    AS "thread_channel_id?",
                ext.provider AS "external_provider?", ext.external_id AS "external_id?",
                ext.external_name AS "external_name?", ext.external_url AS "external_url?"
            FROM agent_session
            LEFT JOIN external_agent_session AS ext ON ext.agent_session_id = agent_session.id
            WHERE egress_token_hash = $1
            "#,
            egress_token_hash,
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to find agent session by egress token hash")?;

        Ok(match row {
            Some(row) => Some(row.try_into()?),
            None => None,
        })
    }

    async fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        // Both are required to match: a session is only reachable from the
        // thread it was created from, by the bot that runs it. NULL params
        // match nothing rather than everything.
        let (Some(thread_id), Some(bot_id)) = (thread_id, bot_id) else {
            return Ok(ChannelSession::None);
        };
        let row = sqlx::query_as!(
            AgentSessionRow,
            r#"
            SELECT
                id, name, owner_id, thread_id, originating_message_id, bot_id,
                model, harness, repo_url, workspace, sandbox_size, instructions,
                acp_session_id, status,
                status_event_name, agent_session.created_at, modified_at,
                (SELECT channel_id FROM comms_messages WHERE id = agent_session.thread_id)
                    AS "thread_channel_id?",
                ext.provider AS "external_provider?", ext.external_id AS "external_id?",
                ext.external_name AS "external_name?", ext.external_url AS "external_url?"
            FROM agent_session
            LEFT JOIN external_agent_session AS ext ON ext.agent_session_id = agent_session.id
            WHERE thread_id = $1 AND bot_id = $2
            ORDER BY agent_session.created_at DESC
            LIMIT 1
            "#,
            thread_id,
            bot_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to find agent session for channel context")?;

        Ok(match row {
            Some(row) => ChannelSession::CreatedFromThread(row.try_into()?),
            None => ChannelSession::None,
        })
    }

    async fn find_all_for_thread(&self, thread_id: Uuid) -> Result<Vec<AgentSession>> {
        let rows = sqlx::query_as!(
            AgentSessionRow,
            r#"
            SELECT
                id, name, owner_id, thread_id, originating_message_id, bot_id,
                model, harness, repo_url, workspace, sandbox_size, instructions,
                acp_session_id, status,
                status_event_name, agent_session.created_at, modified_at,
                (SELECT channel_id FROM comms_messages WHERE id = agent_session.thread_id)
                    AS "thread_channel_id?",
                ext.provider AS "external_provider?", ext.external_id AS "external_id?",
                ext.external_name AS "external_name?", ext.external_url AS "external_url?"
            FROM agent_session
            LEFT JOIN external_agent_session AS ext ON ext.agent_session_id = agent_session.id
            WHERE thread_id = $1
            ORDER BY agent_session.created_at DESC
            "#,
            thread_id,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to find agent sessions for thread")?;

        Ok(rows
            .into_iter()
            .map(AgentSession::try_from)
            .collect::<anyhow::Result<Vec<_>>>()?)
    }

    async fn session_bot(&self, id: BotId) -> Result<SessionBot> {
        // Delegated to the bots hex rather than a bespoke query: this is
        // exactly bot id -> bot, and `get_bot` already excludes deleted bots -
        // which is what this wants, since a deleted bot's old messages should
        // render from the "Agent" fallback below, not its stale name.
        let bot = PgBotsRepo::new(self.pool.clone())
            .get_bot(id)
            .await
            .context("failed to read the session's bot")?;

        // A deleted (or never-existing) bot still has messages in the
        // channel. Falling back to a generic name renders those as from an
        // unknown agent rather than failing the whole log.
        Ok(match bot {
            Some(bot) => SessionBot {
                id,
                name: bot.name,
                avatar_url: bot.avatar_url,
            },
            None => SessionBot {
                id,
                name: "Agent".to_owned(),
                avatar_url: None,
            },
        })
    }

    async fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> Result<()> {
        let acp_session_id = acp_session_id.to_string();
        let result = sqlx::query!(
            r#"
            UPDATE agent_session
            SET acp_session_id = $2,
                modified_at = NOW()
            WHERE id = $1
            "#,
            id.as_uuid(),
            acp_session_id,
        )
        .execute(&self.pool)
        .await
        .context("failed to persist ACP session id")?;

        if result.rows_affected() == 0 {
            return Err(anyhow::anyhow!("agent session not found").into());
        }
        Ok(())
    }

    async fn set_model(&self, id: AgentSessionId, model: &str) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE agent_session
            SET model = $2,
                modified_at = NOW()
            WHERE id = $1
              AND model IS DISTINCT FROM $2
            "#,
            id.as_uuid(),
            model,
        )
        .execute(&self.pool)
        .await
        .context("failed to persist agent session model")?;
        Ok(())
    }

    async fn set_name(&self, id: AgentSessionId, name: &str) -> Result<()> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_session
            SET name = $2,
                modified_at = CASE
                    WHEN name IS DISTINCT FROM $2 THEN NOW()
                    ELSE modified_at
                END
            WHERE id = $1
            "#,
            id.as_uuid(),
            name,
        )
        .execute(&self.pool)
        .await
        .context("failed to persist agent session name")?;

        if result.rows_affected() == 0 {
            return Err(anyhow::anyhow!("agent session not found").into());
        }
        Ok(())
    }

    async fn set_name_if_default(&self, id: AgentSessionId, name: &str) -> Result<bool> {
        let result = sqlx::query!(
            r#"
            UPDATE agent_session
            SET name = $2,
                modified_at = NOW()
            WHERE id = $1
              AND name = $3
            "#,
            id.as_uuid(),
            name,
            crate::domain::model::DEFAULT_AGENT_SESSION_NAME,
        )
        .execute(&self.pool)
        .await
        .context("failed to persist generated agent session name")?;
        Ok(result.rows_affected() == 1)
    }

    async fn set_sandbox_size(&self, id: AgentSessionId, size: SandboxSize) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE agent_session
            SET sandbox_size = $2,
                modified_at = NOW()
            WHERE id = $1
              AND sandbox_size IS DISTINCT FROM $2
            "#,
            id.as_uuid(),
            size.as_str(),
        )
        .execute(&self.pool)
        .await
        .context("failed to persist agent session sandbox size")?;
        Ok(())
    }

    async fn user_sandbox_size(&self, user_id: &MacroUserIdStr<'static>) -> Result<SandboxSize> {
        let size = sqlx::query_scalar!(
            r#"
            SELECT sandbox_size
            FROM user_agent_sandbox_size
            WHERE user_id = $1
            "#,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to read user sandbox size")?;

        match size {
            Some(value) => Ok(parse_sandbox_size(&value)?),
            None => Ok(SandboxSize::Default),
        }
    }

    async fn set_user_sandbox_size(
        &self,
        user_id: &MacroUserIdStr<'static>,
        size: SandboxSize,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO user_agent_sandbox_size (user_id, sandbox_size, modified_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_id) DO UPDATE
            SET sandbox_size = EXCLUDED.sandbox_size,
                modified_at = NOW()
            "#,
            user_id.as_ref(),
            size.as_str(),
        )
        .execute(&self.pool)
        .await
        .context("failed to persist user sandbox size")?;
        Ok(())
    }

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin agent session delete")?;

        // `entity_access.entity_id` is polymorphic and so cannot carry a
        // foreign key: nothing reaps these rows when the session goes, and
        // they would accumulate forever.
        delete_entity_access_rows(&mut transaction, &id.as_uuid(), EntityType::AgentSession)
            .await
            .context("failed to delete agent session entity access rows")?;

        // A session old enough to have owned a dedicated channel leaves it
        // behind: it holds the history that channel renders, and is not this
        // operation's to destroy.
        sqlx::query!(
            r#"
            DELETE FROM agent_session
            WHERE id = $1
            "#,
            id.as_uuid(),
        )
        .execute(&mut *transaction)
        .await
        .context("failed to delete agent session")?;

        transaction
            .commit()
            .await
            .context("commit agent session delete")?;

        Ok(())
    }
}

struct AgentSessionLogRow {
    agent_session_id: Uuid,
    user_id: Option<MacroUserIdStr<'static>>,
    direction: String,
    content: serde_json::Value,
    created_at: DateTime<Utc>,
}

impl TryFrom<AgentSessionLogRow> for StoredAgentSessionLog {
    type Error = anyhow::Error;

    fn try_from(row: AgentSessionLogRow) -> anyhow::Result<Self> {
        Ok(Self {
            created_at: row.created_at,
            entry: AgentSessionLog {
                agent_session_id: AgentSessionId::new_from_uuid(row.agent_session_id),
                user_id: row.user_id,
                content: parse_message(&row.direction, row.content)?,
            },
        })
    }
}

impl ExternalSessionRepo for PgAgentSessionRepo {
    #[tracing::instrument(skip(self), err)]
    async fn upsert(&self, id: AgentSessionId, external: ExternalSession) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO external_agent_session (
                agent_session_id, provider, external_id, external_name, external_url
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (agent_session_id) DO UPDATE SET
                provider = EXCLUDED.provider,
                external_id = EXCLUDED.external_id,
                external_name = EXCLUDED.external_name,
                external_url = EXCLUDED.external_url,
                updated_at = now()
            "#,
            id.as_uuid(),
            external.provider,
            external.external_id,
            external.external_name,
            external.external_url,
        )
        .execute(&self.pool)
        .await
        .context("upsert external agent session")?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get(&self, id: AgentSessionId) -> Result<Option<ExternalSession>> {
        let row = sqlx::query!(
            r#"
            SELECT provider, external_id, external_name, external_url
            FROM external_agent_session
            WHERE agent_session_id = $1
            "#,
            id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("get external agent session")?;
        Ok(row.map(|row| ExternalSession {
            provider: row.provider,
            external_id: row.external_id,
            external_name: row.external_name,
            external_url: row.external_url,
        }))
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        sqlx::query!(
            "DELETE FROM external_agent_session WHERE agent_session_id = $1",
            id.as_uuid(),
        )
        .execute(&self.pool)
        .await
        .context("delete external agent session")?;
        Ok(())
    }
}

impl AgentSessionLogRepo for PgAgentSessionRepo {
    async fn create(&self, log: AgentSessionLog) -> Result<StoredAgentSessionLog> {
        let event_status = match &log.content {
            Message::ToServer(ToServerMessage::Event { event }) => {
                Some(SessionStatus::Event(event.clone()))
            }
            _ => None,
        };
        let (direction, content) = message_columns(&log.content)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin agent session log create")?;
        let created_at = sqlx::query_scalar!(
            r#"
            INSERT INTO agent_session_log (id, agent_session_id, user_id, direction, content)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING created_at
            "#,
            macro_uuid::generate_uuid_v7(),
            log.agent_session_id.as_uuid(),
            log.user_id.as_ref().map(|user_id| user_id.as_ref()),
            direction,
            content,
        )
        .fetch_one(&mut *transaction)
        .await
        .context("failed to create agent session log entry")?;

        if let Some(status) = event_status {
            let (status, status_event_name) = status_columns(&status);
            sqlx::query!(
                r#"
                UPDATE agent_session
                SET status = $2,
                    status_event_name = $3,
                    modified_at = now()
                WHERE id = $1
                "#,
                log.agent_session_id.as_uuid(),
                status,
                status_event_name,
            )
            .execute(&mut *transaction)
            .await
            .context("failed to update agent session status from log entry")?;
        }

        transaction
            .commit()
            .await
            .context("commit agent session log create")?;

        Ok(StoredAgentSessionLog {
            created_at,
            entry: log,
        })
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<StoredAgentSessionLog>> {
        let rows = sqlx::query_as!(
            AgentSessionLogRow,
            r#"
            SELECT
                agent_session_id,
                user_id AS "user_id: MacroUserIdStr",
                direction,
                content,
                created_at
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

/// Folding reads the log through `agent_fold`'s own port; this adapter
/// already speaks [`AgentSessionLogRepo`], so bridging is one line.
impl agent_fold::domain::ports::LogRepo for PgAgentSessionRepo {
    async fn list_by_session(
        &self,
        session: AgentSessionId,
    ) -> std::result::Result<std::collections::VecDeque<AgentSessionLog>, rootcause::Report> {
        let log = AgentSessionLogRepo::list_by_session(self, session)
            .await
            .map_err(|error| rootcause::report!(error))?;
        Ok(log.into_iter().map(|stored| stored.entry).collect())
    }
}

/// Who a channel's frames go to: everyone still in it.
///
/// A participant who has left keeps their row, with `left_at` set - so the
/// filter is what stops a former member being sent a session they can no
/// longer open.
impl SessionAudience for PgAgentSessionRepo {
    async fn viewers(
        &self,
        agent_session_id: AgentSessionId,
    ) -> std::result::Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        // The owner, which is who the dedicated channel's participant
        // list used to resolve to: `create` only ever wrote the one owner
        // row. Widens to a real grant lookup when sessions grow shared
        // access.
        let viewers = sqlx::query_scalar!(
            r#"
            SELECT owner_id AS "owner_id: MacroUserIdStr"
            FROM agent_session
            WHERE id = $1
            "#,
            agent_session_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;

        Ok(viewers)
    }
}
