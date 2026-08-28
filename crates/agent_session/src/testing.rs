//! In-memory port implementations for tests.
//!
//! Lets crates that consume this one - the agent service, `agent_fold` -
//! exercise their own logic against a real [`AgentSessionRepo`] /
//! [`AgentSessionLogRepo`] contract without a database.

use crate::domain::error::{AgentSessionError, Result};
use crate::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, ChannelSession, CreateAgentSessionParams,
    DEFAULT_AGENT_SESSION_NAME, LogAppended, SandboxSize, SessionBot, SessionStatus,
    StoredAgentSessionLog,
};
use crate::domain::ports::{AgentSessionLogRepo, AgentSessionRealtime, AgentSessionRepo};
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use std::collections::HashMap;
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
    /// Egress token hash -> the session it was stored against, mirroring the
    /// unique partial index the real table carries.
    egress_token_hashes: Arc<Mutex<HashMap<String, AgentSessionId>>>,
    logs: Arc<Mutex<HashMap<AgentSessionId, Vec<StoredAgentSessionLog>>>>,
    user_sizes: Arc<Mutex<HashMap<String, SandboxSize>>>,
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
    ///
    /// Each is stamped as it lands, the way the real table's `created_at`
    /// default does.
    pub fn extend_log(&self, entries: impl IntoIterator<Item = AgentSessionLog>) {
        let mut logs = self
            .logs
            .lock()
            .expect("in-memory log store is not poisoned");
        for entry in entries {
            logs.entry(entry.agent_session_id)
                .or_default()
                .push(StoredAgentSessionLog {
                    created_at: chrono::Utc::now(),
                    entry,
                });
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
        let session = AgentSession {
            id: params.id,
            name: DEFAULT_AGENT_SESSION_NAME.to_owned(),
            owner_id: params.owner_id,
            thread_id: params.thread_id,
            // The in-memory repo has no comms rows to derive a channel from.
            thread_channel_id: None,
            originating_message_id: params.originating_message_id,
            bot_id: params.bot_id,
            model: params.model,
            harness: params.harness,
            repo_url: params.repo_url,
            workspace: params.workspace,
            sandbox_size: params.sandbox_size,
            instructions: params.instructions,
            acp_session_id: None,
            external: None,
            status: SessionStatus::default(),
            created_at: now,
            modified_at: now,
        };
        if let Some(hash) = params.egress_token_hash {
            self.egress_token_hashes
                .lock()
                .expect("in-memory session store is not poisoned")
                .insert(hash, session.id);
        }
        self.insert_session(session.clone());
        Ok(session)
    }

    async fn find_by_egress_token_hash(
        &self,
        egress_token_hash: &str,
    ) -> Result<Option<AgentSession>> {
        let id = self
            .egress_token_hashes
            .lock()
            .expect("in-memory session store is not poisoned")
            .get(egress_token_hash)
            .copied();
        Ok(id.and_then(|id| {
            self.sessions
                .lock()
                .expect("in-memory session store is not poisoned")
                .get(&id)
                .cloned()
        }))
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

    async fn find_all_for_thread(&self, thread_id: Uuid) -> Result<Vec<AgentSession>> {
        let mut found: Vec<AgentSession> = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned")
            .values()
            .filter(|session| session.thread_id == Some(thread_id))
            .cloned()
            .collect();
        found.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(found)
    }

    async fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        let sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        let matched = sessions.values().find(|session| {
            thread_id.is_some()
                && bot_id.is_some()
                && session.thread_id == thread_id
                && Some(session.bot_id) == bot_id
        });
        Ok(match matched {
            Some(session) => ChannelSession::CreatedFromThread(session.clone()),
            None => ChannelSession::None,
        })
    }

    async fn session_bot(&self, id: BotId) -> Result<SessionBot> {
        Ok(SessionBot {
            id,
            name: "Test Agent".to_owned(),
            avatar_url: None,
        })
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
        session.acp_session_id = Some(acp_session_id);
        session.modified_at = chrono::Utc::now();
        Ok(())
    }

    async fn set_model(&self, id: AgentSessionId, model: &str) -> Result<()> {
        let mut sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        let session = sessions.get_mut(&id).ok_or_else(|| {
            AgentSessionError::Unknown(anyhow::anyhow!("no agent session {}", id.as_uuid()))
        })?;
        session.model = model.to_owned();
        session.modified_at = chrono::Utc::now();
        Ok(())
    }

    async fn set_name(&self, id: AgentSessionId, name: &str) -> Result<()> {
        let mut sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        let session = sessions.get_mut(&id).ok_or_else(|| {
            AgentSessionError::Unknown(anyhow::anyhow!("no agent session {}", id.as_uuid()))
        })?;
        if session.name == name {
            return Ok(());
        }
        session.name = name.to_owned();
        session.modified_at = chrono::Utc::now();
        Ok(())
    }

    async fn set_name_if_default(&self, id: AgentSessionId, name: &str) -> Result<bool> {
        let mut sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        let session = sessions.get_mut(&id).ok_or_else(|| {
            AgentSessionError::Unknown(anyhow::anyhow!("no agent session {}", id.as_uuid()))
        })?;
        if session.name != DEFAULT_AGENT_SESSION_NAME {
            return Ok(false);
        }
        session.name = name.to_owned();
        session.modified_at = chrono::Utc::now();
        Ok(true)
    }

    async fn set_sandbox_size(&self, id: AgentSessionId, size: SandboxSize) -> Result<()> {
        let mut sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        let session = sessions.get_mut(&id).ok_or_else(|| {
            AgentSessionError::Unknown(anyhow::anyhow!("no agent session {}", id.as_uuid()))
        })?;
        session.sandbox_size = size;
        session.modified_at = chrono::Utc::now();
        Ok(())
    }

    async fn user_sandbox_size(&self, user_id: &MacroUserIdStr<'static>) -> Result<SandboxSize> {
        Ok(self
            .user_sizes
            .lock()
            .expect("in-memory session store is not poisoned")
            .get(user_id.as_ref())
            .copied()
            .unwrap_or_default())
    }

    async fn set_user_sandbox_size(
        &self,
        user_id: &MacroUserIdStr<'static>,
        size: SandboxSize,
    ) -> Result<()> {
        self.user_sizes
            .lock()
            .expect("in-memory session store is not poisoned")
            .insert(user_id.as_ref().to_owned(), size);
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
    async fn create(&self, log: AgentSessionLog) -> Result<StoredAgentSessionLog> {
        let model_change = match &log.content {
            crate::domain::model::Message::ToRuntime(message) => {
                agent_runtime_protocol::domain::action::AgentSetModelAction::from_runtime(message)
            }
            _ => None,
        };
        let event = match &log.content {
            crate::domain::model::Message::ToServer(ToServerMessage::Event { event }) => {
                Some(event.clone())
            }
            _ => None,
        };
        let session_id = log.agent_session_id;
        let stored = StoredAgentSessionLog {
            created_at: chrono::Utc::now(),
            entry: log,
        };
        self.logs
            .lock()
            .expect("in-memory log store is not poisoned")
            .entry(session_id)
            .or_default()
            .push(stored.clone());
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
        if let Some((acp_session_id, change)) = model_change
            && let Some(session) = self
                .sessions
                .lock()
                .expect("in-memory session store is not poisoned")
                .get_mut(&session_id)
            && session.acp_session_id.as_ref() == Some(&acp_session_id)
        {
            session.model = change.model;
            session.modified_at = chrono::Utc::now();
        }
        Ok(stored)
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<StoredAgentSessionLog>> {
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
        Ok(log.into_iter().map(|stored| stored.entry).collect())
    }
}

/// A session fixture with the given id; every other field is a plausible
/// constant.
#[must_use]
pub fn test_agent_session(id: AgentSessionId) -> AgentSession {
    let now = chrono::Utc::now();
    AgentSession {
        id,
        name: DEFAULT_AGENT_SESSION_NAME.to_owned(),
        owner_id: macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com")
            .expect("valid macro user id"),
        thread_id: None,
        thread_channel_id: None,
        originating_message_id: None,
        bot_id: BotId::new_from_uuid(Uuid::from_u128(0xb07)),
        model: "claude-sonnet-5".to_string(),
        harness: "claude-code".to_string(),
        repo_url: Some("https://github.com/example/example".to_string()),
        workspace: "/workspace".to_string(),
        sandbox_size: SandboxSize::Default,
        instructions: None,
        acp_session_id: None,
        external: None,
        status: SessionStatus::NoMessages,
        created_at: now,
        modified_at: now,
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
