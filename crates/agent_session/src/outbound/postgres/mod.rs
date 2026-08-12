//! Postgres implementation of the agent session and agent session log
//! repositories, the fold's log source, the comms placeholder writer, and the
//! channel audience a streamed frame is addressed to.

#[cfg(test)]
mod test;

use crate::domain::error::Result;
use crate::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, Author, ChannelSession,
    CreateAgentSessionParams, Message, MessageId, SessionBot, SessionStatus, TurnId,
};
use crate::domain::ports::{AgentSessionLogRepo, AgentSessionRepo, Comms};
use crate::outbound::connection_gateway_realtime::ChannelAudience;
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use anyhow::Context;
use bots::domain::models::BotId;
use bots::domain::ports::BotRepo;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use sqlx::PgPool;
use std::collections::HashSet;

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
    channel_id: Uuid,
    thread_id: Option<Uuid>,
    originating_message_id: Option<Uuid>,
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

impl TryFrom<AgentSessionRow> for AgentSession {
    type Error = anyhow::Error;

    fn try_from(row: AgentSessionRow) -> anyhow::Result<Self> {
        let status = parse_status(&row.status, row.status_event_name)?;
        Ok(Self {
            id: AgentSessionId::new_from_uuid(row.id),
            channel_id: row.channel_id,
            thread_id: row.thread_id,
            originating_message_id: row.originating_message_id,
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
        } = params;
        let new_channel_id = macro_uuid::generate_uuid_v7();
        let mut transaction = self
            .pool
            .begin()
            .await
            .context("begin agent session create")?;

        sqlx::query!(
            r#"
            INSERT INTO comms_channels (id, name, channel_type, owner_id, kind)
            VALUES ($1, NULL, 'private', $2, 'agent')
            "#,
            new_channel_id,
            owner_id.as_ref(),
        )
        .execute(&mut *transaction)
        .await
        .context("failed to create agent channel")?;

        sqlx::query!(
            r#"
            INSERT INTO comms_channel_participants (channel_id, role, user_id)
            VALUES ($1, 'owner', $2)
            "#,
            new_channel_id,
            owner_id.as_ref(),
        )
        .execute(&mut *transaction)
        .await
        .context("failed to create agent channel owner")?;

        let (status, status_event_name) = status_columns(&SessionStatus::NoMessages);
        let row = sqlx::query_as!(
            AgentSessionRow,
            r#"
            INSERT INTO agent_session (
                id, channel_id, thread_id, originating_message_id, bot_id, model, harness,
                repo_url, acp_session_id, status, status_event_name
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING
                id, channel_id, thread_id, originating_message_id, bot_id, model, harness,
                repo_url, acp_session_id, status, status_event_name, created_at, modified_at
            "#,
            id.as_uuid(),
            new_channel_id,
            thread_id,
            originating_message_id,
            bot_id.as_uuid(),
            model,
            harness,
            repo_url,
            None::<String>,
            status,
            status_event_name,
        )
        .fetch_one(&mut *transaction)
        .await
        .context("failed to create agent session")?;

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
                id, channel_id, thread_id, originating_message_id, bot_id, model, harness,
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

    async fn find_for_channel(
        &self,
        channel_id: Uuid,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        let bot_id = bot_id.map(BotId::as_uuid);
        let rows = sqlx::query_as!(
            AgentSessionRow,
            r#"
            SELECT
                session.id, session.channel_id, session.thread_id,
                session.originating_message_id, session.bot_id,
                session.model, session.harness, session.repo_url, session.acp_session_id,
                session.status, session.status_event_name, session.created_at, session.modified_at
            FROM agent_session session
            WHERE
                session.channel_id = $1 -- it is the dedicated agent channel
                OR (
                    -- otherwise, if it's in a thread and literally mentions the bot
                    session.thread_id = $2
                    AND session.bot_id = $3
                )
                -- we collect both!
            ORDER BY (session.channel_id = $1) DESC, session.created_at DESC
            LIMIT 3
            "#,
            channel_id,
            thread_id,
            bot_id,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to find agent session for channel context")?;

        let sessions = rows
            .into_iter()
            .map(AgentSession::try_from)
            .collect::<anyhow::Result<Vec<_>>>()?;
        let matches_subthread = |session: &AgentSession| {
            thread_id.is_some()
                && bot_id.is_some()
                && session.thread_id == thread_id
                && Some(session.bot_id.as_uuid()) == bot_id
        };

        Ok(match sessions.as_slice() {
            [] => ChannelSession::None,
            [session] if session.channel_id == channel_id => {
                ChannelSession::InDedicatedChannel(session.clone())
            }
            [session] if matches_subthread(session) => {
                ChannelSession::CreatedFromThread(session.clone())
            }
            [dedicated_channel_agent_session, subthread_agent_session]
                if dedicated_channel_agent_session.channel_id == channel_id
                    && matches_subthread(subthread_agent_session) =>
            {
                ChannelSession::ThreadInDedicatedChannel {
                    dedicated_channel_agent_session: dedicated_channel_agent_session.clone(),
                    subthread_agent_session: subthread_agent_session.clone(),
                }
            }
            _ => {
                return Err(
                    anyhow::anyhow!("agent sessions violated channel lookup invariants").into(),
                );
            }
        })
    }

    #[tracing::instrument(err, skip(self))]
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

    async fn update(&self, session: AgentSession) -> Result<()> {
        let (status, status_event_name) = status_columns(&session.status);
        let result = sqlx::query!(
            r#"
            UPDATE agent_session
            SET thread_id = $2,
                originating_message_id = $3,
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
            session.thread_id,
            session.originating_message_id,
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

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        sqlx::query!(
            r#"
            DELETE FROM comms_channels
            WHERE id = (SELECT channel_id FROM agent_session WHERE id = $1)
            "#,
            id.as_uuid(),
        )
        .execute(&self.pool)
        .await
        .context("failed to delete agent session channel")?;

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
        .execute(&mut *transaction)
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
        Ok(log.into())
    }
}

/// Who a channel's frames go to: everyone still in it.
///
/// A participant who has left keeps their row, with `left_at` set - so the
/// filter is what stops a former member being sent a session they can no
/// longer open.
impl ChannelAudience for PgAgentSessionRepo {
    async fn participants(
        &self,
        channel_id: Uuid,
    ) -> std::result::Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        let participants = sqlx::query_scalar!(
            r#"
            SELECT user_id AS "user_id: MacroUserIdStr"
            FROM comms_channel_participants
            WHERE channel_id = $1 AND left_at IS NULL
            "#,
            channel_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;

        Ok(participants)
    }
}

impl Comms for PgAgentSessionRepo {
    async fn messages_with_placeholders(
        &self,
        session: &AgentSession,
    ) -> std::result::Result<HashSet<MessageId>, rootcause::Report> {
        let rows = sqlx::query!(
            r#"
            SELECT identifier.turn, identifier.author
            FROM comms_messages AS message
            JOIN agent_session_message_identifier AS identifier
              ON identifier.id = message.agent_session_message_identifier_id
            WHERE message.channel_id = $1
              AND identifier.agent_session_id = $2
            "#,
            session.channel_id,
            session.id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;

        rows.into_iter()
            .map(|row| {
                Ok(MessageId {
                    turn: TurnId(u32::try_from(row.turn).map_err(|_| {
                        rootcause::report!("agent session turn out of range: {}", row.turn)
                    })?),
                    author: row.author.parse().map_err(|_| {
                        rootcause::report!("invalid agent session author: {}", row.author)
                    })?,
                })
            })
            .collect()
    }

    async fn create_message_placeholder(
        &self,
        session: &AgentSession,
        id: MessageId,
        author: &Author,
    ) -> std::result::Result<(), rootcause::Report> {
        let sender = self.placeholder_sender(session, author).await?;
        sqlx::query!(
            r#"
            WITH identifier AS (
                INSERT INTO agent_session_message_identifier (id, agent_session_id, turn, author)
                VALUES ($4, $5, $6, $7)
                ON CONFLICT (agent_session_id, turn, author)
                -- A no-op update so the existing row's id is returned; a
                -- re-offered placeholder must resolve to the identifier it
                -- already has, not the id minted for this attempt.
                DO UPDATE SET turn = EXCLUDED.turn
                RETURNING id
            )
            INSERT INTO comms_messages (
                id,
                channel_id,
                sender_id,
                agent_session_message_identifier_id
            )
            SELECT $1, $2, $3, identifier.id
            FROM identifier
            ON CONFLICT (agent_session_message_identifier_id)
                WHERE agent_session_message_identifier_id IS NOT NULL
                DO NOTHING
            "#,
            macro_uuid::generate_uuid_v7(),
            session.channel_id,
            sender,
            macro_uuid::generate_uuid_v7(),
            session.id.as_uuid(),
            i64::from(id.turn.0),
            id.author.as_str(),
        )
        .execute(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;

        Ok(())
    }
}

impl PgAgentSessionRepo {
    /// The `sender_id` a placeholder row carries.
    ///
    /// The agent's messages are sent by the session's bot. A user's are sent
    /// by that user - but the fold only knows who they were when the log row
    /// carried a `user_id`, which recorded and replayed sessions do not. When
    /// it does not, the session's channel owner stands in: they are the only
    /// person the session is known to belong to.
    async fn placeholder_sender(
        &self,
        session: &AgentSession,
        author: &Author,
    ) -> std::result::Result<String, rootcause::Report> {
        let user_id = match author {
            Author::Agent => return Ok(session.bot_id.into_storage_id().to_string()),
            Author::User(Some(user_id)) => return Ok(user_id.to_string()),
            Author::User(None) => sqlx::query_scalar!(
                r#"
                SELECT user_id
                FROM comms_channel_participants
                WHERE channel_id = $1 AND role = 'owner'
                LIMIT 1
                "#,
                session.channel_id,
            )
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| rootcause::report!(error))?,
        };

        // A channel always has an owner participant - `create` writes one in
        // the same transaction - but fall back rather than fail a render.
        Ok(user_id.unwrap_or_else(|| session.bot_id.into_storage_id().to_string()))
    }
}
