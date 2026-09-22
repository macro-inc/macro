//! In-memory port implementations for tests.
//!
//! Lets crates that consume this one - the agent service, `agent_fold` -
//! exercise their own logic against a real [`AgentSessionRepo`] /
//! [`AgentSessionLogRepo`] contract without a database.

use crate::domain::error::{AgentSessionError, Result};
use crate::domain::events::AgentSessionLifecycleEvent;
use crate::domain::model::{
    AgentMcpServers, AgentSession, AgentSessionId, AgentSessionLog, AgentSessionPreviewData,
    ClaimOutcome, CreateAgentSessionParams, DEFAULT_AGENT_SESSION_NAME, LogAppended, ManagerFence,
    ReplicaAddress, ReplicaId, SandboxSize, SessionBot, SessionClaim, SessionManager,
    SessionPreviewCandidate, SessionStatus, StoredAgentSessionLog, ThreadSession,
};
use crate::domain::ports::{
    AgentSessionLifecyclePublisher, AgentSessionLogRepo, AgentSessionRealtime, AgentSessionRepo,
    REPLICA_STALE_AFTER, SessionOwnership,
};
use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

mod working_branch;

/// One session's lease state: the holding replica (if any) and the fence,
/// which outlives the holder as in the real schema.
type Lease = (Option<ReplicaId>, i64);

/// One replica's row: its last heartbeat and published forwarding address.
type ReplicaRow = (std::time::Instant, Option<ReplicaAddress>);

/// An in-memory [`AgentSessionRepo`] and [`AgentSessionLogRepo`].
///
/// Cheap to clone - clones share one store, so a handle kept for assertions
/// sees writes made through the copy under test. History uses the same
/// `(created_at, id)` ordering and inclusive boundary as the PostgreSQL repo.
#[derive(Debug, Clone, Default)]
pub struct InMemoryAgentSessionRepo {
    sessions: Arc<Mutex<HashMap<AgentSessionId, AgentSession>>>,
    /// Egress token hash -> the session it was stored against, mirroring the
    /// unique partial index the real table carries.
    egress_token_hashes: Arc<Mutex<HashMap<String, AgentSessionId>>>,
    logs: Arc<Mutex<HashMap<AgentSessionId, Vec<StoredAgentSessionLog>>>>,
    log_transaction: Arc<Mutex<()>>,
    history_boundaries: Arc<Mutex<HashMap<AgentSessionId, macro_uuid::Uuid>>>,
    turn_states: Arc<Mutex<HashMap<AgentSessionId, agent_fold::domain::model::TurnState>>>,
    working_branches: Arc<Mutex<HashMap<AgentSessionId, String>>>,
    user_sizes: Arc<Mutex<HashMap<String, SandboxSize>>>,
    log_reads: Arc<AtomicUsize>,
    session_reads: Arc<AtomicUsize>,
    /// Replica heartbeats and published addresses, mirroring `harness_replica`.
    replicas: Arc<Mutex<HashMap<ReplicaId, ReplicaRow>>>,
    /// Session -> lease, mirroring the lease columns: release clears the
    /// holder and leaves the counter.
    leases: Arc<Mutex<HashMap<AgentSessionId, Lease>>>,
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

    /// The activity projection last committed with this session's log.
    #[must_use]
    pub fn turn_state(
        &self,
        session: AgentSessionId,
    ) -> Option<agent_fold::domain::model::TurnState> {
        self.turn_states.lock().unwrap().get(&session).copied()
    }

    /// The last runtime branch accepted for the session's repository.
    #[must_use]
    pub fn working_branch(&self, session: AgentSessionId) -> Option<String> {
        self.working_branches.lock().unwrap().get(&session).cloned()
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
    /// Give seeded frames strictly increasing timestamps: an in-memory loop
    /// can outrun the clock, and UUIDv7 suffixes do not preserve insertion order
    /// when the production `(created_at, id)` reader breaks timestamp ties.
    pub fn extend_log(&self, entries: impl IntoIterator<Item = AgentSessionLog>) {
        let mut logs = self
            .logs
            .lock()
            .expect("in-memory log store is not poisoned");
        for entry in entries {
            let rows = logs.entry(entry.agent_session_id).or_default();
            let now = chrono::Utc::now();
            let created_at = rows.last().map_or(now, |last| {
                now.max(last.created_at + chrono::Duration::microseconds(1))
            });
            rows.push(StoredAgentSessionLog {
                id: macro_uuid::generate_uuid_v7(),
                created_at,
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
            repo_branch: params.repo_branch,
            pull_request_url: None,
            id: params.id,
            name: DEFAULT_AGENT_SESSION_NAME.to_owned(),
            owner_id: params.owner_id,
            thread_id: params.thread_id,
            // The in-memory repo has no comms rows to derive a channel from.
            thread_parent: None,
            originating_message_id: params.originating_message_id,
            bot_id: params.bot_id,
            model: params.model,
            harness: params.harness,
            repo_url: params.repo_url,
            workspace: params.workspace,
            sandbox_size: params.sandbox_size,
            instructions: params.instructions,
            mcp_servers: params.mcp_servers,
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

    async fn preview(
        &self,
        viewer: &MacroUserIdStr<'static>,
        ids: &[AgentSessionId],
    ) -> Result<Vec<SessionPreviewCandidate>> {
        // No `entity_access` rows to consult here: the owner is the one grant
        // `create` always writes, so ownership stands in for a grant.
        let sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        Ok(ids
            .iter()
            .filter_map(|id| sessions.get(id))
            .map(|session| SessionPreviewCandidate {
                data: AgentSessionPreviewData {
                    bot: None,
                    id: session.id,
                    name: session.name.clone(),
                    owner_id: session.owner_id.clone(),
                    bot_id: session.bot_id,
                    status: session.status.clone(),
                    created_at: session.created_at,
                    modified_at: session.modified_at,
                },
                has_grant: session.owner_id.is_user(viewer),
                thread_parent: session.thread_parent.clone(),
            })
            .collect())
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

    async fn find_for_thread(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ThreadSession> {
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
            Some(session) => ThreadSession::CreatedFromThread(session.clone()),
            None => ThreadSession::None,
        })
    }

    async fn recent_for_owner(
        &self,
        owner: &MacroUserIdStr<'_>,
        limit: NonZeroUsize,
    ) -> Result<Vec<AgentSession>> {
        let mut found: Vec<AgentSession> = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned")
            .values()
            .filter(|session| session.owner_id.is_user(owner))
            .cloned()
            .collect();
        found.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.as_uuid().cmp(&a.id.as_uuid()))
        });
        found.truncate(limit.get());
        Ok(found)
    }

    async fn session_bot(&self, id: BotId) -> Result<SessionBot> {
        Ok(SessionBot {
            id,
            name: "Test Agent".to_owned(),
            handle: "test-agent".to_owned(),
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

    async fn set_egress_token_hash(&self, id: AgentSessionId, hash: &str) -> Result<()> {
        self.get(id).await?;
        let mut hashes = self
            .egress_token_hashes
            .lock()
            .expect("token store poisoned");
        hashes.retain(|_, session| *session != id);
        hashes.insert(hash.to_owned(), id);
        Ok(())
    }

    async fn set_repo_url(&self, id: AgentSessionId, repo_url: Option<String>) -> Result<()> {
        let mut sessions = self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned");
        let session = sessions.get_mut(&id).ok_or_else(|| {
            AgentSessionError::Unknown(anyhow::anyhow!("no agent session {}", id.as_uuid()))
        })?;
        if session.repo_url != repo_url {
            session.repo_url = repo_url;
            self.working_branches.lock().unwrap().remove(&id);
            session.modified_at = chrono::Utc::now();
        }
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
        let _transaction = self.log_transaction.lock().unwrap();
        self.history_boundaries.lock().unwrap().remove(&id);
        self.turn_states.lock().unwrap().remove(&id);
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

impl SessionOwnership for InMemoryAgentSessionRepo {
    async fn claim(&self, session: AgentSessionId, replica: ReplicaId) -> Result<ClaimOutcome> {
        if !self
            .sessions
            .lock()
            .expect("in-memory session store is not poisoned")
            .contains_key(&session)
        {
            return Err(AgentSessionError::Unknown(anyhow::anyhow!(
                "agent session {session} does not exist to claim"
            )));
        }
        let now = std::time::Instant::now();
        let mut replicas = self
            .replicas
            .lock()
            .expect("in-memory replica store is not poisoned");
        replicas.entry(replica).or_insert((now, None)).0 = now;
        let mut leases = self
            .leases
            .lock()
            .expect("in-memory lease store is not poisoned");
        let (holder, fence) = leases.entry(session).or_insert((None, 0));
        let holder_is_live = holder.filter(|holder| *holder != replica).filter(|holder| {
            replicas
                .get(holder)
                .is_some_and(|(beat, _)| now.duration_since(*beat) < REPLICA_STALE_AFTER)
        });
        if let Some(holder) = holder_is_live {
            return Ok(ClaimOutcome::ManagedElsewhere(holder));
        }
        *holder = Some(replica);
        *fence += 1;
        Ok(ClaimOutcome::Claimed(SessionClaim {
            session,
            replica,
            fence: ManagerFence(*fence),
        }))
    }

    async fn release(&self, claim: &SessionClaim) -> Result<()> {
        let mut leases = self
            .leases
            .lock()
            .expect("in-memory lease store is not poisoned");
        if let Some((holder, fence)) = leases.get_mut(&claim.session)
            && *holder == Some(claim.replica)
            && *fence == claim.fence.0
        {
            *holder = None;
        }
        Ok(())
    }

    async fn heartbeat(&self, replica: ReplicaId, address: Option<&ReplicaAddress>) -> Result<()> {
        let mut replicas = self
            .replicas
            .lock()
            .expect("in-memory replica store is not poisoned");
        let entry = replicas
            .entry(replica)
            .or_insert((std::time::Instant::now(), None));
        entry.0 = std::time::Instant::now();
        // As in the real adapter: a beat carrying no address keeps the one
        // already published.
        if let Some(address) = address {
            entry.1 = Some(address.clone());
        }
        Ok(())
    }

    async fn manager_of(&self, session: AgentSessionId) -> Result<Option<SessionManager>> {
        let leases = self
            .leases
            .lock()
            .expect("in-memory lease store is not poisoned");
        let Some((Some(holder), _)) = leases.get(&session) else {
            return Ok(None);
        };
        let replicas = self
            .replicas
            .lock()
            .expect("in-memory replica store is not poisoned");
        Ok(replicas
            .get(holder)
            .filter(|(beat, _)| beat.elapsed() < REPLICA_STALE_AFTER)
            .map(|(_, address)| SessionManager {
                replica: *holder,
                address: address.clone(),
            }))
    }
}

impl InMemoryAgentSessionRepo {
    fn create_log(&self, log: AgentSessionLog) -> Result<StoredAgentSessionLog> {
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
            id: macro_uuid::generate_uuid_v7(),
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
}

impl crate::domain::turn_state::SessionTurnProjectionRepo for InMemoryAgentSessionRepo {
    async fn unprojected_sessions(&self, limit: NonZeroUsize) -> Result<Vec<AgentSessionId>> {
        let sessions = self.sessions.lock().unwrap();
        let turns = self.turn_states.lock().unwrap();
        let mut ids: Vec<_> = sessions
            .keys()
            .filter(|id| !turns.contains_key(id))
            .copied()
            .collect();
        ids.sort_by_key(|id| id.as_uuid());
        ids.truncate(limit.get());
        Ok(ids)
    }

    async fn initialize_turn_state(
        &self,
        session: AgentSessionId,
        last_log_id: Option<Uuid>,
        turn_state: agent_fold::domain::model::TurnState,
    ) -> Result<bool> {
        let _transaction = self.log_transaction.lock().unwrap();
        if !self.sessions.lock().unwrap().contains_key(&session) {
            return Ok(false);
        }
        let logs = self.logs.lock().unwrap();
        let current = logs
            .get(&session)
            .into_iter()
            .flatten()
            .max_by_key(|row| (row.created_at, row.id))
            .map(|row| row.id);
        let mut turns = self.turn_states.lock().unwrap();
        if current != last_log_id || turns.contains_key(&session) {
            return Ok(false);
        }
        turns.insert(session, turn_state);
        Ok(true)
    }
}

impl AgentSessionLogRepo for InMemoryAgentSessionRepo {
    async fn create(&self, log: AgentSessionLog) -> Result<StoredAgentSessionLog> {
        self.create_projected(log, None, None, None).await
    }

    async fn participants(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<MacroUserIdStr<'static>>> {
        let logs = self.logs.lock().unwrap();
        let mut users: Vec<MacroUserIdStr<'static>> = Vec::new();
        for user in logs
            .get(&agent_session_id)
            .into_iter()
            .flatten()
            .filter_map(|row| row.entry.user_id.clone())
        {
            if !users.contains(&user) {
                users.push(user);
            }
        }
        Ok(users)
    }

    async fn create_fenced(
        &self,
        log: AgentSessionLog,
        claim: &SessionClaim,
    ) -> Result<StoredAgentSessionLog> {
        self.create_fenced_with_boundary(log, claim, None).await
    }

    async fn create_batch_fenced(
        &self,
        entries: Vec<StoredAgentSessionLog>,
        claim: &SessionClaim,
    ) -> Result<Vec<StoredAgentSessionLog>> {
        if entries.is_empty() {
            return Ok(entries);
        }
        if entries
            .iter()
            .any(|stored| stored.entry.agent_session_id != claim.session)
        {
            return Err(AgentSessionError::FencedOut(claim.session));
        }
        let _transaction = self.log_transaction.lock().unwrap();
        let session = claim.session;
        {
            let leases = self.leases.lock().unwrap();
            if !matches!(
                leases.get(&session), Some((holder, fence))
                    if *holder == Some(claim.replica) && *fence == claim.fence.0
            ) || !self.sessions.lock().unwrap().contains_key(&session)
            {
                return Err(AgentSessionError::FencedOut(session));
            }
        }
        // Consecutive microseconds from one instant, as the Postgres store
        // does, so a batch orders by `(created_at, id)` in append order.
        let now = chrono::Utc::now();
        let mut stored_entries = Vec::with_capacity(entries.len());
        for (index, stored) in entries.into_iter().enumerate() {
            let mut created = self.create_log(stored.entry)?;
            created.id = stored.id;
            created.created_at = now + chrono::Duration::microseconds(index as i64);
            let mut logs = self.logs.lock().unwrap();
            let rows = logs.get_mut(&session).expect("create_log inserted the row");
            let row = rows.last_mut().expect("create_log inserted the row");
            *row = created.clone();
            stored_entries.push(created);
        }
        Ok(stored_entries)
    }

    async fn create_fenced_with_boundary(
        &self,
        log: AgentSessionLog,
        claim: &SessionClaim,
        boundary: Option<crate::domain::model::HistoryBoundary>,
    ) -> Result<StoredAgentSessionLog> {
        self.create_projected(log, Some(claim), boundary, None)
            .await
    }

    async fn create_projected(
        &self,
        log: AgentSessionLog,
        claim: Option<&SessionClaim>,
        boundary: Option<crate::domain::model::HistoryBoundary>,
        turn_state: Option<agent_fold::domain::model::TurnState>,
    ) -> Result<StoredAgentSessionLog> {
        if boundary.is_some() && claim.is_none() {
            return Err(AgentSessionError::FencedOut(log.agent_session_id));
        }
        let _transaction = self.log_transaction.lock().unwrap();
        let leases = self.leases.lock().unwrap();
        if claim.is_some_and(|claim| {
            claim.session != log.agent_session_id
                || !matches!(
                    leases.get(&log.agent_session_id), Some((holder, fence))
                        if *holder == Some(claim.replica) && *fence == claim.fence.0
                )
        }) {
            return Err(AgentSessionError::FencedOut(log.agent_session_id));
        }
        if !self
            .sessions
            .lock()
            .unwrap()
            .contains_key(&log.agent_session_id)
        {
            return Err(AgentSessionError::FencedOut(log.agent_session_id));
        }
        if let Some(boundary) = boundary {
            let logs = self.logs.lock().unwrap();
            if !logs.get(&log.agent_session_id).is_some_and(|rows| {
                rows.iter()
                    .any(|row| row.id == boundary.initialization_log_id)
            }) {
                return Err(AgentSessionError::Handshake(
                    "invalid history boundary".into(),
                ));
            }
        }
        let session = log.agent_session_id;
        let stored = self.create_log(log)?;
        if let Some(boundary) = boundary {
            self.history_boundaries
                .lock()
                .unwrap()
                .insert(session, boundary.initialization_log_id);
        }
        if let Some(turn_state) = turn_state {
            self.turn_states.lock().unwrap().insert(session, turn_state);
        }
        Ok(stored)
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<StoredAgentSessionLog>> {
        self.log_reads.fetch_add(1, Ordering::Relaxed);
        let _transaction = self.log_transaction.lock().unwrap();
        let logs = self.logs.lock().unwrap();
        let mut rows = logs.get(&agent_session_id).cloned().unwrap_or_default();
        rows.sort_unstable_by_key(|row| (row.created_at, row.id));
        let boundary = self
            .history_boundaries
            .lock()
            .unwrap()
            .get(&agent_session_id)
            .copied();
        let start = boundary
            .and_then(|id| rows.iter().position(|row| row.id == id))
            .unwrap_or(0);
        Ok(rows.into_iter().skip(start).collect())
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
        repo_branch: None,
        pull_request_url: None,
        id,
        name: DEFAULT_AGENT_SESSION_NAME.to_owned(),
        owner_id: model_owner::Owner::User(
            macro_user_id::user_id::MacroUserIdStr::try_from_email("owner@example.com")
                .expect("valid macro user id"),
        ),
        thread_id: None,
        thread_parent: None,
        originating_message_id: None,
        bot_id: BotId::new_from_uuid(Uuid::from_u128(0xb07)),
        model: "claude-sonnet-5".to_string(),
        harness: "claude-code".to_string(),
        repo_url: Some("https://github.com/example/example".to_string()),
        workspace: "/workspace".to_string(),
        sandbox_size: SandboxSize::Default,
        instructions: None,
        mcp_servers: AgentMcpServers::OwnerConnections,
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
    updated: Arc<Mutex<Vec<AgentSessionId>>>,
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
            updated: Arc::default(),
            down: true,
        }
    }

    /// Sessions whose persisted metadata changed.
    pub fn updated(&self) -> Vec<AgentSessionId> {
        self.updated.lock().unwrap().clone()
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
    async fn publish_updated(
        &self,
        session: AgentSessionId,
    ) -> std::result::Result<(), rootcause::Report> {
        if self.down {
            return Err(rootcause::report!("the connection gateway is down"));
        }
        self.updated.lock().unwrap().push(session);
        Ok(())
    }

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

#[cfg(test)]
mod test;

/// An [`AgentSessionLifecyclePublisher`] that keeps every event, for
/// asserting what a flow published and in what order.
///
/// Cheap to clone - clones share one store. `wait_for_published` is a real
/// wait on a `watch`: a publish that lands before the waiter subscribes is
/// counted, and nothing polls.
#[derive(Debug, Clone)]
pub struct RecordingLifecyclePublisher {
    published: Arc<Mutex<Vec<AgentSessionLifecycleEvent>>>,
    count: tokio::sync::watch::Sender<usize>,
}

impl Default for RecordingLifecyclePublisher {
    fn default() -> Self {
        Self::new()
    }
}

impl RecordingLifecyclePublisher {
    /// A publisher that records everything.
    #[must_use]
    pub fn new() -> Self {
        Self {
            published: Arc::default(),
            count: tokio::sync::watch::Sender::new(0),
        }
    }

    /// Everything published, in order.
    #[must_use]
    pub fn published(&self) -> Vec<AgentSessionLifecycleEvent> {
        self.published
            .lock()
            .expect("in-memory lifecycle store is not poisoned")
            .clone()
    }

    /// Resolve once at least `count` events have been published.
    pub async fn wait_for_published(&self, count: usize) {
        let mut receiver = self.count.subscribe();
        receiver
            .wait_for(|published| *published >= count)
            .await
            .expect("the recording publisher holds the sender");
    }
}

impl AgentSessionLifecyclePublisher for RecordingLifecyclePublisher {
    fn publish(
        &self,
        event: AgentSessionLifecycleEvent,
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        self.published
            .lock()
            .expect("in-memory lifecycle store is not poisoned")
            .push(event);
        self.count.send_modify(|published| *published += 1);
        Box::pin(async {})
    }
}

impl crate::domain::pull_request::SessionPullRequestRepo for InMemoryAgentSessionRepo {
    async fn record_pull_request(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        url: &str,
        claim: Option<SessionClaim>,
    ) -> Result<bool> {
        // Keep the claim lock through the mutation, matching the PostgreSQL row lock.
        let leases = self.leases.lock().unwrap();
        if let Some(claim) = claim
            && (claim.session != session
                || !leases.get(&session).is_some_and(|(replica, fence)| {
                    *replica == Some(claim.replica) && *fence == claim.fence.0
                }))
        {
            return Err(AgentSessionError::FencedOut(session));
        }
        let mut sessions = self.sessions.lock().unwrap();
        let stored = sessions
            .get_mut(&session)
            .filter(|stored| stored.owner_id.is_user(owner))
            .ok_or(AgentSessionError::Forbidden)?;
        if stored.pull_request_url.as_deref() == Some(url) {
            return Ok(false);
        }
        stored.pull_request_url = Some(url.to_owned());
        stored.modified_at = chrono::Utc::now();
        Ok(true)
    }
}
