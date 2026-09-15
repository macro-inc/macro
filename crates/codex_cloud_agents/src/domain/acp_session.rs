//! Serial cloud conversations, durable launch receipts, and provider-grounded completion.
use super::cloud::{CloudEvent, CloudId, Launch, NativeRecord, TurnId};
use super::journal::{JournalEntry, JournalInput, ReplayMachine};
use super::runtime::{CloudRuntime, CloudTarget};
mod metadata;
use futures::StreamExt as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use tokio::sync::Mutex;

/// Durable conversation state. Pending writes are never retried automatically.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredSession {
    /// Account binding prevents replay after switching OAuth accounts.
    pub account_id: String,
    /// Connection generation pinned for hosted account reconnects.
    pub connection_id: String,
    /// Destination pinned before the first cloud submission; absent until selection succeeds.
    pub target: Option<CloudTarget>,
    /// The single remote task backing this conversation.
    pub task: Option<String>,
    /// Latest assistant turn used as the parent for continuation.
    pub turn: Option<String>,
    /// A write began without a durably recorded receipt.
    pub uncertain_write: bool,
}
/// Persistence boundary for conversation identity and replay.
pub trait SessionStore: Send + Sync {
    /// Read a previously created session.
    fn load(
        &self,
        id: &str,
    ) -> impl Future<Output = Result<Option<StoredSession>, rootcause::Report>> + Send;
    /// Atomically checkpoint a session before acknowledging provider writes.
    fn save(
        &self,
        id: &str,
        state: &StoredSession,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
    /// Read the complete ordered native input journal.
    fn read(
        &self,
        id: &str,
    ) -> impl Future<Output = Result<Vec<JournalEntry>, rootcause::Report>> + Send;
    /// Append only if the expected sequence and attachment fence still match.
    fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> impl Future<Output = Result<JournalEntry, rootcause::Report>> + Send;
    /// Verify this attachment still owns its management generation before provider calls.
    fn validate(&self) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}
/// Session event delivery implemented by the inbound connection.
pub trait SessionSink: Send + Sync {
    /// Queue one ordered event; errors stop local observation.
    fn emit(&self, event: &CloudEvent) -> Result<(), rootcause::Report>;
    /// Request a transactional replacement after silently captured recovery output.
    /// Return true when the host must load before another prompt may run.
    fn recovered(&self) -> Result<bool, rootcause::Report> {
        Ok(false)
    }
}
struct Discard;
impl SessionSink for Discard {
    fn emit(&self, _: &CloudEvent) -> Result<(), rootcause::Report> {
        Ok(())
    }
}
/// Verified provider terminal outcome.
pub enum Outcome {
    /// Provider completed successfully.
    Completed,
    /// Provider explicitly reports cancellation.
    Cancelled,
}
struct Session {
    state: Mutex<StoredSession>,
    machine: Mutex<ReplayMachine>,
    turn_lock: Arc<tokio::sync::Mutex<()>>,
    recovery_gate: std::sync::Mutex<bool>,
    cancel: AtomicBool,
    reload_pending: AtomicBool,
    changed: tokio::sync::Notify,
    metadata_lock: Mutex<()>,
    published_pr: Mutex<Option<String>>,
}
/// Exclusive recovery reservation retained across the ACP load response.
pub struct Recovery {
    session: Arc<Session>,
    guard: Option<tokio::sync::OwnedMutexGuard<()>>,
}
impl Drop for Recovery {
    fn drop(&mut self) {
        let mut recovering = self
            .session
            .recovery_gate
            .lock()
            .expect("recovery gate poisoned");
        drop(self.guard.take());
        *recovering = false;
        self.session.changed.notify_waiters();
    }
}
/// Owns serial turns while cancellation remains independently runnable.
pub struct SessionService<R, J> {
    probe: Arc<R>,
    fixed_session: Option<String>,

    journal: J,
    explicit_target: Option<CloudTarget>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    metadata_changed: tokio::sync::Notify,
}
impl<R: CloudRuntime, J: SessionStore> SessionService<R, J> {
    /// Compose cloud and persistence ports with an explicit remote target.
    pub fn new(probe: Arc<R>, journal: J, explicit_target: Option<CloudTarget>) -> Self {
        Self {
            probe,
            fixed_session: None,
            journal,
            explicit_target,
            sessions: Mutex::new(HashMap::new()),
            metadata_changed: tokio::sync::Notify::new(),
        }
    }
    /// Pin ACP identity to the host session so a lost new-session response cannot orphan a launch.
    pub fn with_session_id(mut self, id: String) -> Self {
        self.fixed_session = Some(id);
        self
    }
    /// Create a local session without starting cloud execution.
    pub async fn new_session(&self) -> Result<String, rootcause::Report> {
        let id = self
            .fixed_session
            .clone()
            .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
        if self.journal.load(&id).await?.is_some() {
            self.session(&id).await?;
            self.metadata_changed.notify_one();
            return Ok(id);
        }
        let auth = self.probe.identity().await?;
        self.journal
            .save(
                &id,
                &StoredSession {
                    account_id: auth.account_id,
                    connection_id: auth.connection_id,
                    ..StoredSession::default()
                },
            )
            .await?;
        self.journal
            .append(&id, 0, None, &JournalInput::HistoryComplete)
            .await?;
        self.session(&id).await?;
        self.metadata_changed.notify_one();
        Ok(id)
    }
    async fn session(&self, id: &str) -> Result<Arc<Session>, rootcause::Report> {
        self.journal.validate().await?;
        let current_identity = self.probe.identity().await?;
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(id) {
            let state = session.state.lock().await;
            if state.account_id != current_identity.account_id
                || state.connection_id != current_identity.connection_id
            {
                return Err(rootcause::report!(
                    "saved session belongs to a different account or connection"
                ));
            }
            return Ok(session.clone());
        }
        let state = self
            .journal
            .load(id)
            .await?
            .ok_or_else(|| rootcause::report!("unknown session"))?;
        if (state.task.is_some() || state.turn.is_some()) && state.target.is_none() {
            return Err(rootcause::report!("saved cloud task has no pinned target"));
        }
        let auth = self.probe.identity().await?;
        if state.account_id != auth.account_id || state.connection_id != auth.connection_id {
            return Err(rootcause::report!(
                "saved session belongs to a different account or remote target"
            ));
        }
        let entries = self.journal.read(id).await?;
        if entries.is_empty() {
            return Err(rootcause::report!(
                "native journal has no complete history boundary"
            ));
        }
        let mut machine = ReplayMachine::default();
        for entry in &entries {
            machine.push(entry)?;
        }
        machine.finish();
        let session = Arc::new(Session {
            machine: Mutex::new(machine),
            state: Mutex::new(state),
            turn_lock: Arc::new(tokio::sync::Mutex::new(())),
            recovery_gate: std::sync::Mutex::new(false),
            cancel: AtomicBool::new(false),
            reload_pending: AtomicBool::new(false),
            changed: tokio::sync::Notify::new(),
            metadata_lock: Mutex::new(()),
            published_pr: Mutex::new(None),
        });
        sessions.insert(id.to_owned(), session.clone());
        Ok(session)
    }
    /// Replay the durable conversation without launching or continuing work.
    pub async fn replay(&self, id: &str, sink: &impl SessionSink) -> Result<(), rootcause::Report> {
        let session = self.session(id).await?;
        let _guard = session
            .turn_lock
            .try_lock()
            .map_err(|_| rootcause::report!("session is busy"))?;
        self.replay_entries(id, sink).await
    }
    async fn replay_entries(
        &self,
        id: &str,
        sink: &impl SessionSink,
    ) -> Result<(), rootcause::Report> {
        let session = self.session(id).await?;
        let state = session.state.lock().await.clone();
        let entries = self.journal.read(id).await?;
        if entries.is_empty() {
            return Err(rootcause::report!(
                "native journal has no complete history boundary"
            ));
        }
        // Associations can arrive after a later prompt. Rebuild their tool activity
        // beside the originating turn rather than attributing it to that later turn.
        let mut catalog = ReplayMachine::default();
        for entry in &entries {
            catalog.push(entry)?;
        }
        let mut machine = ReplayMachine::default();
        let mut current_turn = None;
        let emit = |event: CloudEvent, turn: &mut Option<String>| {
            if event.method == "session/turn_complete"
                && let Some(turn) = turn.as_deref()
                && let Some(pr) = metadata::pull_request_event(&catalog, &state, turn)
            {
                sink.emit(&pr)?;
            }
            if event.method == "user/message" {
                *turn = None;
            }
            sink.emit(&event)
        };
        for entry in &entries {
            if let JournalInput::PromptAccepted { turn, .. } = &entry.input {
                current_turn = turn.clone();
            }
            for event in machine.push(entry)? {
                emit(event, &mut current_turn)?;
            }
        }
        for event in machine.finish() {
            emit(event, &mut current_turn)?;
        }
        Ok(())
    }

    async fn finish_events(
        &self,
        session: &Session,
        sink: &impl SessionSink,
    ) -> Result<(), rootcause::Report> {
        let state = session.state.lock().await.clone();
        let mut machine = session.machine.lock().await;
        for event in machine.finish() {
            if event.method == "session/turn_complete"
                && let Some(turn) = state.turn.as_deref()
                && let Some(pr) = metadata::pull_request_event(&machine, &state, turn)
            {
                sink.emit(&pr)?;
            }
            sink.emit(&event)?;
        }
        Ok(())
    }
    async fn record(
        &self,
        id: &str,
        session: &Session,
        input: JournalInput,
        sink: &impl SessionSink,
    ) -> Result<Vec<CloudEvent>, rootcause::Report> {
        let turn = match &input {
            JournalInput::PromptAccepted { turn, .. } => turn.clone(),
            _ => session.state.lock().await.turn.clone(),
        }
        .map(TurnId::new)
        .transpose()?;
        let mut machine = session.machine.lock().await;
        machine.ensure_appendable(&input)?;
        let entry = self
            .journal
            .append(id, machine.sequence(), turn.as_ref(), &input)
            .await?;
        let events = machine.push(&entry)?;
        if matches!(&input, JournalInput::Poll {snapshot,..} if !snapshot.pull_requests.is_empty())
        {
            self.metadata_changed.notify_one();
        }
        for event in &events {
            sink.emit(event)?;
        }
        Ok(events)
    }
    async fn observe_event(
        &self,
        id: &str,
        session: &Session,
        task: &CloudId,
        record: NativeRecord,
        sink: &impl SessionSink,
    ) -> Result<(), rootcause::Report> {
        let events = self
            .record(id, session, JournalInput::Native(record), sink)
            .await?;
        if events.iter().any(|event| {
            event.method.contains("requestApproval")
                || event.method.contains("requestUserInput")
                || event.method.contains("elicitation")
        }) {
            self.journal.validate().await?;
            self.probe.cancel(task).await?;
            return Err(rootcause::report!(
                "cloud turn requested interactive input or approval unsupported by this adapter; remote cancellation requested"
            ));
        }
        Ok(())
    }
    /// Signal and perform remote cancellation without waiting for the turn lock.
    pub async fn cancel(&self, id: &str) -> Result<(), rootcause::Report> {
        self.journal.validate().await?;
        let session = self.session(id).await?;
        self.record(id, &session, JournalInput::CancellationRequested, &Discard)
            .await?;
        session.cancel.store(true, Ordering::SeqCst);
        session.changed.notify_waiters();
        let task = session.state.lock().await.task.clone();
        if let Some(task) = task {
            self.probe.cancel(&CloudId::new(task)?).await?;
        }
        Ok(())
    }
    /// Preserve the client's original text blocks in the native input journal.
    pub async fn prompt(
        &self,
        id: &str,
        blocks: Vec<agent_client_protocol::schema::v1::ContentBlock>,
        sink: &impl SessionSink,
    ) -> Result<Outcome, rootcause::Report> {
        let prompt = blocks
            .iter()
            .map(|block| match block {
                agent_client_protocol::schema::v1::ContentBlock::Text(text) => {
                    Ok(text.text.as_str())
                }
                _ => Err(rootcause::report!("only text prompt blocks are supported")),
            })
            .collect::<Result<Vec<_>, _>>()?
            .join("\n");
        self.journal.validate().await?;
        if prompt.trim().is_empty() || prompt.len() > 64 * 1024 {
            return Err(rootcause::report!(
                "provide a nonempty prompt (maximum 64 KiB)"
            ));
        }
        let session = self.session(id).await?;
        let _guard = loop {
            let changed = session.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if session.reload_pending.load(Ordering::SeqCst) {
                changed.await;
                continue;
            }
            // Classify the held lock atomically with recovery reservation/drop.
            let immediate =
                {
                    let recovering = session
                        .recovery_gate
                        .lock()
                        .expect("recovery gate poisoned");
                    if *recovering {
                        None
                    } else {
                        Some(session.turn_lock.try_lock().map_err(|_| {
                            rootcause::report!("session already has a running prompt")
                        })?)
                    }
                };
            let guard = match immediate {
                Some(guard) => guard,
                None => session.turn_lock.lock().await,
            };
            if !session.reload_pending.load(Ordering::SeqCst) {
                break guard;
            }
            drop(guard);
        };
        self.journal.validate().await?;
        session.cancel.store(false, Ordering::SeqCst);
        let previous = session.state.lock().await.clone();
        if previous.uncertain_write {
            return Err(rootcause::report!(
                "previous submission has an uncertain outcome; inspect cloud tasks before starting another session"
            ));
        }
        if let Some(task) = &previous.task {
            let mut snapshot = self.probe.snapshot(&CloudId::new(task.clone())?).await?;
            let native = snapshot.native.take();
            self.record(
                id,
                &session,
                JournalInput::Poll {
                    snapshot: snapshot.clone(),
                    native,
                },
                sink,
            )
            .await?;
            if let Some(current) = snapshot
                .turns
                .iter()
                .find(|turn| turn.source == "current_assistant_turn")
                .and_then(|turn| turn.id.as_ref())
                && previous.turn.as_ref() != Some(current)
            {
                return Err(rootcause::report!(
                    "cloud conversation advanced outside this session; refusing to branch from an older turn"
                ));
            }
            if !snapshot.terminal() {
                return Err(rootcause::report!(
                    "existing cloud task is still running or has unknown status; cancel it or wait before continuing"
                ));
            }
        }
        let target = match previous.target {
            Some(target) => target,
            None => {
                let selecting = self
                    .probe
                    .resolve_target(&prompt, self.explicit_target.as_ref());
                tokio::pin!(selecting);
                let target = loop {
                    let changed = session.changed.notified();
                    tokio::pin!(changed);
                    changed.as_mut().enable();
                    if session.cancel.load(Ordering::SeqCst) {
                        return Ok(Outcome::Cancelled);
                    }
                    tokio::select! {
                        result = &mut selecting => {
                            if session.cancel.load(Ordering::SeqCst) { return Ok(Outcome::Cancelled); }
                            break result?;
                        }
                        _ = changed => {}
                    }
                };
                target.validate()?;
                self.journal.validate().await?;
                if session.cancel.load(Ordering::SeqCst) {
                    return Ok(Outcome::Cancelled);
                }
                let mut state = session.state.lock().await;
                let mut updated = state.clone();
                updated.target = Some(target.clone());
                self.journal.save(id, &updated).await?;
                *state = updated;
                target
            }
        };
        if session.cancel.load(Ordering::SeqCst) {
            return Ok(Outcome::Cancelled);
        }
        let request = Launch {
            environment: target.environment,
            branch: target.branch,
            prompt,
        };
        self.record(id, &session, JournalInput::Prompt(blocks), sink)
            .await?;
        {
            let mut state = session.state.lock().await;
            let mut updated = state.clone();
            updated.uncertain_write = true;
            self.journal.save(id, &updated).await?;
            *state = updated;
        }
        let receipt = match (&previous.task, &previous.turn) {
            (Some(task), Some(turn)) => {
                self.probe
                    .follow_up(
                        &CloudId::new(task.clone())?,
                        &TurnId::new(turn.clone())?,
                        &request.prompt,
                    )
                    .await
            }
            (None, None) => self.probe.launch(&request).await,
            _ => {
                return Err(rootcause::report!(
                    "saved task has no assistant turn; inspect it before continuing"
                ));
            }
        };
        let receipt = match receipt {
            Ok(receipt) => receipt,
            Err(error) => {
                let message = error.format_current_context().to_string();
                self.record(id, &session, JournalInput::SubmissionError(message), sink)
                    .await?;
                return Err(error);
            }
        };
        self.record(
            id,
            &session,
            JournalInput::PromptAccepted {
                task: receipt.task_id.as_str().to_owned(),
                turn: receipt
                    .assistant_turn_id
                    .as_ref()
                    .map(|turn| turn.as_str().to_owned()),
            },
            sink,
        )
        .await?;
        let task = receipt.task_id;
        {
            let mut state = session.state.lock().await;
            let mut updated = state.clone();
            updated.task = Some(task.as_str().to_owned());
            updated.turn = receipt
                .assistant_turn_id
                .as_ref()
                .map(|turn| turn.as_str().to_owned());
            updated.uncertain_write = updated.turn.is_none();
            self.journal.save(id, &updated).await?;
            *state = updated;
        }
        let turn = receipt.assistant_turn_id.ok_or_else(|| {
            rootcause::report!(
                "provider created task without assistant turn; submission will not be retried"
            )
        })?;
        if session.cancel.load(Ordering::SeqCst) {
            self.probe.cancel(&task).await?;
        }
        let outcome = self.observe(id, session.clone(), task, turn, sink).await;
        self.finish_events(&session, sink).await?;
        outcome
    }
    async fn reserve_recovery(&self, id: &str) -> Result<Recovery, rootcause::Report> {
        self.journal.validate().await?;
        let session = self.session(id).await?;
        let guard = loop {
            let changed = session.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            let guard = {
                let mut recovering = session
                    .recovery_gate
                    .lock()
                    .expect("recovery gate poisoned");
                if *recovering {
                    None
                } else {
                    let guard = session
                        .turn_lock
                        .clone()
                        .try_lock_owned()
                        .map_err(|_| rootcause::report!("session is busy"))?;
                    *recovering = true;
                    Some(guard)
                }
            };
            if let Some(guard) = guard {
                break guard;
            }
            changed.await;
        };
        let recovery = Recovery {
            session,
            guard: Some(guard),
        };
        if recovery.session.state.lock().await.uncertain_write {
            return Err(rootcause::report!(
                "previous submission has an uncertain outcome; inspect cloud tasks before continuing"
            ));
        }
        Ok(recovery)
    }
    /// Replay and reserve the old turn before the client can send a new prompt.
    pub async fn prepare_recovery(
        &self,
        id: &str,
        sink: &impl SessionSink,
    ) -> Result<Recovery, rootcause::Report> {
        let recovery = self.reserve_recovery(id).await?;
        self.replay_entries(id, sink).await?;
        self.metadata_changed.notify_one();
        recovery
            .session
            .reload_pending
            .store(false, Ordering::SeqCst);
        recovery.session.changed.notify_waiters();
        Ok(recovery)
    }
    /// Reattach observation to a durably recorded turn, never creating provider work.
    pub async fn resume_observation(
        &self,
        id: &str,
        sink: &impl SessionSink,
    ) -> Result<Option<Outcome>, rootcause::Report> {
        let recovery = self.reserve_recovery(id).await?;
        self.finish_recovery(id, recovery, sink).await
    }
    /// Observe the reserved turn while follow-up prompts wait for its verified outcome.
    pub async fn finish_recovery(
        &self,
        id: &str,
        recovery: Recovery,
        sink: &impl SessionSink,
    ) -> Result<Option<Outcome>, rootcause::Report> {
        let session = recovery.session.clone();
        let state = session.state.lock().await.clone();
        if state.uncertain_write {
            return Err(rootcause::report!(
                "previous submission has an uncertain outcome; inspect cloud tasks before continuing"
            ));
        }
        let (Some(task), Some(turn)) = (state.task, state.turn) else {
            return Ok(None);
        };
        self.record(id, &session, JournalInput::RecoveryStarted, sink)
            .await?;
        let outcome = self
            .observe(
                id,
                session.clone(),
                CloudId::new(task)?,
                TurnId::new(turn)?,
                sink,
            )
            .await
            .map(Some);
        self.finish_events(&session, sink).await?;
        if sink.recovered()? {
            session.reload_pending.store(true, Ordering::SeqCst);
        }
        drop(recovery);
        outcome
    }
    async fn observe(
        &self,
        id: &str,
        session: Arc<Session>,
        task: CloudId,
        turn: TurnId,
        sink: &impl SessionSink,
    ) -> Result<Outcome, rootcause::Report> {
        let mut stream = match self.probe.stream(&task, &turn).await {
            Ok(stream) => Some(stream),
            Err(error) => {
                let message = error.format_current_context().to_string();
                self.record(id, &session, JournalInput::TransportError(message), sink)
                    .await?;
                None
            }
        };
        let mut reconnects = 0_u8;
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            tokio::select! {
                event = async { match &mut stream { Some(stream) => stream.next().await, None => std::future::pending().await } } => {
                    match event {
                        Some(Ok(event)) => {
                            self.observe_event(id, &session, &task, event, sink).await?;
                        }
                        Some(Err(error)) => { let message = error.format_current_context().to_string(); self.record(id, &session, JournalInput::TransportError(message), sink).await?; stream = None; }
                        None => { self.record(id, &session, JournalInput::TransportError("stream ended".into()), sink).await?; stream = None; }
                    }
                }
                _ = interval.tick() => {
                    self.journal.validate().await?;
                    let mut snapshot = self.probe.turn(&task, &turn).await?;
                    let native = snapshot.native.take();
                    self.record(id, &session, JournalInput::Poll { snapshot: snapshot.clone(), native }, sink).await?;
                    match snapshot.assistant_status.as_deref() {
                        Some("completed") => {
                            // A terminal snapshot can race queued SSE records; drain available
                            // history before reconciling the authoritative final message.
                            if let Some(active) = &mut stream {
                                let drain = async {
                                    while let Some(Ok(event)) = active.next().await {
                                        self.observe_event(id, &session, &task, event, sink).await?;
                                    }
                                    Ok::<(), rootcause::Report>(())
                                };
                                if let Ok(result) = tokio::time::timeout(Duration::from_secs(2), drain).await { result?; }
                            }
                            // The completed replay can expose records absent from the live
                            // stream. Stable outer IDs suppress records already journaled.
                            if let Ok(mut replay) = self.probe.stream(&task, &turn).await {
                                let drain = async {
                                    while let Some(Ok(event)) = replay.next().await { self.observe_event(id, &session, &task, event, sink).await?; }
                                    Ok::<(), rootcause::Report>(())
                                };
                                if let Ok(result) = tokio::time::timeout(Duration::from_secs(2), drain).await { result?; }
                            }
                            self.record(id, &session, JournalInput::Terminal("completed".into()), sink).await?;
                            return Ok(Outcome::Completed);
                        }
                        Some("cancelled") => { self.record(id, &session, JournalInput::Terminal("cancelled".into()), sink).await?; return Ok(Outcome::Cancelled); },
                        Some("failed") => { self.record(id, &session, JournalInput::Terminal("failed".into()), sink).await?; return Err(rootcause::report!("cloud assistant turn failed")); },
                        _ => {
                            if stream.is_none() && reconnects < 3 {
                                reconnects += 1;
                                stream = self.probe.stream(&task, &turn).await.ok();
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod test;
