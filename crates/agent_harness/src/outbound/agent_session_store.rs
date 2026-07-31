//! Postgres adapter for `agent_sessions`.
//!
//! [`PgAgentSessionStore::find_for_thread`] is the query from the spec: filter
//! to our `bot_id` and match the incoming message's thread against **both**
//! thread columns, so one round trip distinguishes the three cases -
//!
//! - `created_from_thread_id = $thread` - started from this thread, so this is
//!   a continuation in the originating thread
//! - `thread_id = $thread` - the message arrived inside the session's own
//!   orphaned thread
//! - no row - no session of ours here
//!
//! Still open, and both concern `create` rather than the lookup:
//!
//! - **One session per bot per thread** is this store's invariant. Two mentions
//!   of the same bot in the same thread can be processed concurrently off
//!   different Kafka partitions, so `create` needs a unique index to lose that
//!   race against rather than a read-then-write. A partial unique index on
//!   `(bot_id, created_from_thread_id)` is the candidate, but it has to tolerate
//!   ended (`Offline`/`Failed`) sessions if one may be superseded.
//! - **`thread_id` references `comms_messages`**, so the message that anchors
//!   the session's thread has to exist before the row is inserted - the reply
//!   has to be posted first.

use bot_id::BotId;
use macro_uuid::Uuid;

use crate::domain::models::{AgentSession, AgentSessionStatus, ThreadSession};
use crate::domain::ports::{AgentSessionStore, NewAgentSession};

/// `agent_session_status` as Postgres spells it.
///
/// Its own type rather than a derive on the domain enum: `sqlx::Type` would put
/// database concerns in `domain`, and the mapping is four arms.
#[derive(Debug, Clone, Copy, sqlx::Type)]
#[sqlx(type_name = "agent_session_status", rename_all = "lowercase")]
enum DbStatus {
    Booting,
    Ready,
    Offline,
    Failed,
}

impl From<DbStatus> for AgentSessionStatus {
    fn from(status: DbStatus) -> Self {
        match status {
            DbStatus::Booting => Self::Booting,
            DbStatus::Ready => Self::Ready,
            DbStatus::Offline => Self::Offline,
            DbStatus::Failed => Self::Failed,
        }
    }
}

impl From<AgentSessionStatus> for DbStatus {
    fn from(status: AgentSessionStatus) -> Self {
        match status {
            AgentSessionStatus::Booting => Self::Booting,
            AgentSessionStatus::Ready => Self::Ready,
            AgentSessionStatus::Offline => Self::Offline,
            AgentSessionStatus::Failed => Self::Failed,
        }
    }
}

/// Reads and writes `agent_sessions` in MacroDB.
pub struct PgAgentSessionStore {
    pool: sqlx::PgPool,
}

impl PgAgentSessionStore {
    /// Build the store over a MacroDB pool.
    #[must_use]
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { pool }
    }
}

impl AgentSessionStore for PgAgentSessionStore {
    #[tracing::instrument(err, skip(self))]
    async fn find_for_thread(
        &self,
        bot_id: BotId,
        thread_id: Option<Uuid>,
    ) -> anyhow::Result<ThreadSession> {
        // A message outside any thread cannot be inside an agent thread, and
        // cannot continue one either, so there is nothing to look up.
        let Some(thread_id) = thread_id else {
            return Ok(ThreadSession::None);
        };

        let row = sqlx::query!(
            r#"
            SELECT id,
                   created_from_thread_id,
                   thread_id,
                   bot_id,
                   model,
                   harness,
                   repo_url,
                   last_status AS "last_status: DbStatus"
            FROM agent_sessions
            WHERE bot_id = $1
              AND (created_from_thread_id = $2 OR thread_id = $2)
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            bot_id.as_uuid(),
            thread_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(ThreadSession::None);
        };

        // Which column matched is what tells the two cases apart. A session's
        // own thread is a different message from the thread it was created
        // from, so at most one of these can hold.
        let in_session_thread = row.thread_id == thread_id;
        let session = AgentSession {
            id: row.id,
            created_from_thread_id: row.created_from_thread_id,
            thread_id: row.thread_id,
            bot_id: BotId::new_from_uuid(row.bot_id),
            model: row.model,
            harness: row.harness,
            repo_url: row.repo_url,
            last_status: row.last_status.into(),
        };

        Ok(if in_session_thread {
            ThreadSession::InSessionThread(session)
        } else {
            ThreadSession::CreatedFromThisThread(session)
        })
    }

    async fn create(&self, _session: NewAgentSession) -> anyhow::Result<AgentSession> {
        todo!("blocked: thread_id references comms_messages, so the reply must be posted first")
    }

    #[tracing::instrument(err, skip(self))]
    async fn set_status(&self, id: Uuid, status: AgentSessionStatus) -> anyhow::Result<()> {
        sqlx::query!(
            r#"
            UPDATE agent_sessions
            SET last_status = $2, modified_at = NOW()
            WHERE id = $1
            "#,
            id,
            DbStatus::from(status) as DbStatus,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
