//! In-memory port implementations for tests.
//!
//! Lets crates that consume this one - the agent service, `agent_fold` -
//! exercise their own logic against a real [`AgentSessionRepo`] /
//! [`AgentSessionLogRepo`] contract without a database.

use crate::domain::error::{AgentSessionError, Result};
use crate::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, Author, ChannelSession,
    CreateAgentSessionParams, LogAppended, MessageId, SessionBot, SessionStatus,
};
use crate::domain::ports::{AgentSessionLogRepo, AgentSessionRealtime, AgentSessionRepo, Comms};
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use bots::domain::models::BotId;
use macro_uuid::Uuid;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

/// An in-memory [`AgentSessionRepo`] and [`AgentSessionLogRepo`].
///
/// Cheap to clone - clones share one store, so a handle kept for assertions
/// sees writes made through the copy under test. Log entries are returned in
/// insertion order, which is the chronology the real repo gets from
/// `ORDER BY created_at, id`.
#[derive(Debug, Clone, Default)]
pub struct InMemoryAgentSessionRepo {
    sessions: Arc<Mutex<HashMap<AgentSessionId, AgentSession>>>,
    logs: Arc<Mutex<HashMap<AgentSessionId, Vec<AgentSessionLog>>>>,
    log_reads: Arc<AtomicUsize>,
    session_reads: Arc<AtomicUsize>,
}

impl InMemoryAgentSessionRepo {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Seed a session, bypassing [`AgentSessionRepo::create`] so a test can
    /// choose the id and channel it will query by.
    pub fn insert_session(&self, session: AgentSession) {
        self.sessions
            .lock()
            .expect("in-memory session store is not poisoned")
            .insert(session.id, session);
    }

    /// How many times a session's whole log has been read back.
    ///
    /// A read is what folding a session from scratch costs, so this is how a
    /// test tells "folded once and kept the state" from "refolded per frame".
    #[must_use]
    pub fn log_reads(&self) -> usize {
        self.log_reads.load(Ordering::Relaxed)
    }

    /// How many times a session row has been read back.
    ///
    /// A writer needs the session's channel to address a streamed frame at
    /// it, so this is how a test tells "looked it up once and kept it" from
    /// "a read per frame".
    #[must_use]
    pub fn session_reads(&self) -> usize {
        self.session_reads.load(Ordering::Relaxed)
    }

    /// Seed log entries, in the order they should be read back.
    pub fn extend_log(&self, entries: impl IntoIterator<Item = AgentSessionLog>) {
        let mut logs = self
            .logs
            .lock()
            .expect("in-memory log store is not poisoned");
        for entry in entries {
            logs.entry(entry.agent_session_id).or_default().push(entry);
        }
    }
}

impl FromIterator<AgentSessionLog> for InMemoryAgentSessionRepo {
    fn from_iter<I: IntoIterator<Item = AgentSessionLog>>(entries: I) -> Self {
        let repo = Self::new();
        repo.extend_log(entries);
        repo
    }
}

impl AgentSessionRepo for InMemoryAgentSessionRepo {
    async fn create(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        let now = chrono::Utc::now();
        // The real repo creates a dedicated channel owned by `params.owner_id`;
        // in memory the channel is just a fresh id.
        let session = AgentSession {
            id: params.id,
            channel_id: macro_uuid::generate_uuid_v7(),
            thread_id: params.thread_id,
            originating_message_id: params.originating_message_id,
            bot_id: params.bot_id,
            model: params.model,
            harness: params.harness,
            repo_url: params.repo_url,
            acp_session_id: None,
            status: SessionStatus::default(),
            created_at: now,
            modified_at: now,
        };
        self.insert_session(session.clone());
        Ok(session)
    }

    async fn get(&self, id: AgentSessionId) -> Result<AgentSession> {
        self.session_reads.fetch_add(1, Ordering::Relaxed);
        self.sessions
            .lock()
            .expect("in-memory session store is not poisoned")
            .get(&id)
            .cloned()
            .ok_or_else(|| {
                AgentSessionError::Unknown(anyhow::anyhow!("no agent session {}", id.as_uuid()))
            })
    }

    async fn find_for_channel(
        &self,
        channel_id: Uuid,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        let sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        let matches_subthread = |session: &AgentSession| {
            thread_id.is_some()
                && bot_id.is_some()
                && session.thread_id == thread_id
                && Some(session.bot_id) == bot_id
        };
        let dedicated = sessions
            .values()
            .find(|session| session.channel_id == channel_id)
            .cloned();
        let subthread = sessions
            .values()
            .find(|session| session.channel_id != channel_id && matches_subthread(session))
            .cloned();
        Ok(match (dedicated, subthread) {
            (Some(dedicated_channel_agent_session), Some(subthread_agent_session)) => {
                ChannelSession::ThreadInDedicatedChannel {
                    dedicated_channel_agent_session,
                    subthread_agent_session,
                }
            }
            (Some(session), None) => ChannelSession::InDedicatedChannel(session),
            (None, Some(session)) => ChannelSession::CreatedFromThread(session),
            (None, None) => ChannelSession::None,
        })
    }

    async fn session_bot(&self, id: BotId) -> Result<SessionBot> {
        Ok(SessionBot {
            id,
            name: "Test Agent".to_owned(),
            avatar_url: None,
        })
    }

    async fn update(&self, session: AgentSession) -> Result<()> {
        self.insert_session(session);
        Ok(())
    }

    async fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> Result<()> {
        let mut sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        let session = sessions.get_mut(&id).ok_or_else(|| {
            AgentSessionError::Unknown(anyhow::anyhow!("no agent session {}", id.as_uuid()))
        })?;
        session.acp_session_id = Some(acp_session_id.to_string());
        session.modified_at = chrono::Utc::now();
        Ok(())
    }

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        self.sessions
            .lock()
            .expect("in-memory session store is not poisoned")
            .remove(&id);
        self.logs
            .lock()
            .expect("in-memory log store is not poisoned")
            .remove(&id);
        Ok(())
    }
}

impl AgentSessionLogRepo for InMemoryAgentSessionRepo {
    async fn create(&self, log: AgentSessionLog) -> Result<()> {
        let event = match &log.content {
            crate::domain::model::Message::ToServer(ToServerMessage::Event { event }) => {
                Some(event.clone())
            }
            _ => None,
        };
        let session_id = log.agent_session_id;
        self.extend_log([log]);
        if let Some(event) = event
            && let Some(session) = self
                .sessions
                .lock()
                .expect("in-memory session store is not poisoned")
                .get_mut(&session_id)
        {
            session.status = SessionStatus::Event(event);
            session.modified_at = chrono::Utc::now();
        }
        Ok(())
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<AgentSessionLog>> {
        self.log_reads.fetch_add(1, Ordering::Relaxed);
        Ok(self
            .logs
            .lock()
            .expect("in-memory log store is not poisoned")
            .get(&agent_session_id)
            .cloned()
            .unwrap_or_default())
    }
}

/// The trivial [`agent_fold::domain::ports::LogRepo`] bridge: folding reads
/// the log through the fold crate's own port, and this store already speaks
/// [`AgentSessionLogRepo`], so bridging is one line - the same shape as the
/// real Postgres adapter's impl.
impl agent_fold::domain::ports::LogRepo for InMemoryAgentSessionRepo {
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

/// A session fixture with the given id and channel; every other field is a
/// plausible constant.
#[must_use]
pub fn test_agent_session(id: AgentSessionId, channel_id: Uuid) -> AgentSession {
    let now = chrono::Utc::now();
    AgentSession {
        id,
        channel_id,
        thread_id: None,
        originating_message_id: None,
        bot_id: BotId::new_from_uuid(Uuid::from_u128(0xb07)),
        model: "claude-sonnet-5".to_string(),
        harness: "claude-code".to_string(),
        repo_url: "https://github.com/example/example".to_string(),
        acp_session_id: None,
        status: SessionStatus::NoMessages,
        created_at: now,
        modified_at: now,
    }
}

/// An in-memory [`Comms`] that records the placeholder messages written
/// through it.
///
/// Behaves like the real table, including its partial unique index on
/// `agent_session_message_id`: writing a message that already has a row is
/// accepted and changes nothing, the way `ON CONFLICT DO NOTHING` does. That
/// matters because a live connection relies on it - see
/// [`Comms::create_message_placeholder`] - so a store that appended blindly
/// would report duplicates the real one cannot produce.
///
/// Cheap to clone - clones share one store.
#[derive(Debug, Clone, Default)]
pub struct RecordingComms {
    /// `(channel_id, message)` pairs, in write order, one per message.
    messages: Arc<Mutex<Vec<(Uuid, MessageId)>>>,
    /// Every write offered, including the ones the unique index absorbed.
    offered: Arc<AtomicUsize>,
}

impl RecordingComms {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The placeholder rows the channel holds, as `(channel_id, message)` in
    /// the order they first landed.
    #[must_use]
    pub fn created(&self) -> Vec<(Uuid, MessageId)> {
        self.messages
            .lock()
            .expect("in-memory comms store is not poisoned")
            .clone()
    }

    /// How many placeholder writes were offered, counting the redundant ones
    /// a reconnecting session re-derives and the index throws away.
    #[must_use]
    pub fn offered(&self) -> usize {
        self.offered.load(Ordering::Relaxed)
    }
}

/// An in-memory [`AgentSessionRealtime`] that records what was published, and
/// can be told to fail.
///
/// Failing is worth having in the kit rather than in one test: the port is
/// best-effort by contract, so "a publisher that is down changes nothing about
/// the durable append" is the property every caller of it has to hold.
///
/// Cheap to clone - clones share one store.
#[derive(Debug, Clone, Default)]
pub struct RecordingRealtime {
    published: Arc<Mutex<Vec<LogAppended>>>,
    down: bool,
}

impl RecordingRealtime {
    /// A publisher that accepts everything.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A publisher that refuses everything, recording nothing.
    #[must_use]
    pub fn down() -> Self {
        Self {
            published: Arc::default(),
            down: true,
        }
    }

    /// Everything published, in order.
    #[must_use]
    pub fn published(&self) -> Vec<LogAppended> {
        self.published
            .lock()
            .expect("in-memory realtime store is not poisoned")
            .clone()
    }
}

impl AgentSessionRealtime for RecordingRealtime {
    async fn publish(&self, event: LogAppended) -> std::result::Result<(), rootcause::Report> {
        if self.down {
            return Err(rootcause::report!("the connection gateway is down"));
        }
        self.published
            .lock()
            .expect("in-memory realtime store is not poisoned")
            .push(event);
        Ok(())
    }
}

impl Comms for RecordingComms {
    async fn messages_with_placeholders(
        &self,
        session: &AgentSession,
    ) -> std::result::Result<HashSet<MessageId>, rootcause::Report> {
        Ok(self
            .messages
            .lock()
            .expect("in-memory comms store is not poisoned")
            .iter()
            .filter(|(channel, _)| *channel == session.channel_id)
            .map(|(_, id)| *id)
            .collect())
    }

    async fn create_message_placeholder(
        &self,
        session: &AgentSession,
        id: MessageId,
        _author: &Author,
    ) -> std::result::Result<(), rootcause::Report> {
        self.offered.fetch_add(1, Ordering::Relaxed);
        let mut messages = self
            .messages
            .lock()
            .expect("in-memory comms store is not poisoned");
        // The unique index, in memory: a message that already has a row is
        // left alone rather than written twice.
        if !messages.iter().any(|(_, held)| *held == id) {
            messages.push((session.channel_id, id));
        }
        Ok(())
    }
}
