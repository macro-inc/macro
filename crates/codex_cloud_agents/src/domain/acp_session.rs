//! Serial cloud conversations, durable launch receipts, and provider-grounded completion.
use super::cloud::{CloudConversation, CloudEvent, CloudId, Launch, TurnId};
use super::{CredentialStore, OAuth, Probe, unix_now};
use futures::StreamExt as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

/// Durable conversation state. Pending writes are never retried automatically.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct StoredSession {
    /// Account binding prevents replay after switching OAuth accounts.
    pub account_id: String,
    /// Explicit remote environment binding.
    pub environment: String,
    /// Explicit remote branch binding.
    pub branch: String,
    /// The single remote task backing this conversation.
    pub task: Option<String>,
    /// Latest assistant turn used as the parent for continuation.
    pub turn: Option<String>,
    /// A write began without a durably recorded receipt.
    pub uncertain_write: bool,
    /// Ordered provider and user events for client replay.
    pub history: Vec<CloudEvent>,
}
/// Persistence boundary for conversation identity and replay.
pub trait SessionStore: Send + Sync {
    /// Read a previously created session.
    fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report>;
    /// Atomically checkpoint a session before acknowledging provider writes.
    fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report>;
}
/// Session event delivery implemented by the inbound connection.
pub trait SessionSink: Send + Sync {
    /// Queue one ordered event; errors stop local observation.
    fn emit(&self, event: &CloudEvent) -> Result<(), rootcause::Report>;
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
    turn_lock: tokio::sync::Mutex<()>,
    cancel: AtomicBool,
}
/// Owns serial turns while cancellation remains independently runnable.
pub struct SessionService<P, S, J> {
    probe: Arc<Probe<P, S>>,
    journal: J,
    environment: CloudId,
    branch: String,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
impl<P: OAuth + CloudConversation, S: CredentialStore + Send + Sync, J: SessionStore>
    SessionService<P, S, J>
{
    /// Compose cloud and persistence ports with an explicit remote target.
    pub fn new(probe: Arc<Probe<P, S>>, journal: J, environment: CloudId, branch: String) -> Self {
        Self {
            probe,
            journal,
            environment,
            branch,
            sessions: Mutex::new(HashMap::new()),
        }
    }
    /// Create a local session without starting cloud execution.
    pub fn new_session(&self) -> Result<String, rootcause::Report> {
        let id = uuid::Uuid::now_v7().to_string();
        let auth = self
            .probe
            .status()?
            .ok_or_else(|| rootcause::report!("not connected; run login first"))?;
        self.journal.save(
            &id,
            &StoredSession {
                account_id: auth.account_id,
                environment: self.environment.as_str().into(),
                branch: self.branch.clone(),
                ..StoredSession::default()
            },
        )?;
        self.session(&id)?;
        Ok(id)
    }
    fn session(&self, id: &str) -> Result<Arc<Session>, rootcause::Report> {
        let mut sessions = self.sessions.lock().expect("session map poisoned");
        if let Some(session) = sessions.get(id) {
            return Ok(session.clone());
        }
        let state = self
            .journal
            .load(id)?
            .ok_or_else(|| rootcause::report!("unknown session"))?;
        let auth = self
            .probe
            .status()?
            .ok_or_else(|| rootcause::report!("not connected; run login first"))?;
        if state.account_id != auth.account_id
            || state.environment != self.environment.as_str()
            || state.branch != self.branch
        {
            return Err(rootcause::report!(
                "saved session belongs to a different account or remote target"
            ));
        }
        let session = Arc::new(Session {
            state: Mutex::new(state),
            turn_lock: tokio::sync::Mutex::new(()),
            cancel: AtomicBool::new(false),
        });
        sessions.insert(id.to_owned(), session.clone());
        Ok(session)
    }
    /// Replay the durable conversation without launching or continuing work.
    pub fn replay(&self, id: &str, sink: &impl SessionSink) -> Result<(), rootcause::Report> {
        let session = self.session(id)?;
        let _guard = session
            .turn_lock
            .try_lock()
            .map_err(|_| rootcause::report!("session is busy"))?;
        for event in &session.state.lock().expect("session poisoned").history {
            sink.emit(event)?;
        }
        Ok(())
    }
    fn record(
        &self,
        id: &str,
        session: &Session,
        event: CloudEvent,
        sink: &impl SessionSink,
    ) -> Result<(), rootcause::Report> {
        let mut state = session.state.lock().expect("session poisoned");
        if !event.id.is_empty() && state.history.iter().any(|old| old.id == event.id) {
            return Ok(());
        }
        let mut updated = state.clone();
        updated.history.push(event.clone());
        self.journal.save(id, &updated)?;
        *state = updated;
        sink.emit(&event)
    }
    async fn observe_event(
        &self,
        id: &str,
        session: &Session,
        task: &CloudId,
        event: CloudEvent,
        sink: &impl SessionSink,
    ) -> Result<(), rootcause::Report> {
        if event.method.contains("requestApproval")
            || event.method.contains("requestUserInput")
            || event.method.contains("elicitation")
        {
            self.probe.cancel(task, unix_now()?).await?;
            return Err(rootcause::report!(
                "cloud turn requested interactive input or approval unsupported by this adapter; remote cancellation requested"
            ));
        }
        self.record(id, session, event, sink)
    }
    /// Signal and perform remote cancellation without waiting for the turn lock.
    pub async fn cancel(&self, id: &str) -> Result<(), rootcause::Report> {
        let session = self.session(id)?;
        session.cancel.store(true, Ordering::SeqCst);
        let task = session.state.lock().expect("session poisoned").task.clone();
        if let Some(task) = task {
            self.probe.cancel(&CloudId::new(task)?, unix_now()?).await?;
        }
        Ok(())
    }
    /// Submit one turn and observe until provider state proves its outcome.
    pub async fn prompt(
        &self,
        id: &str,
        prompt: String,
        sink: &impl SessionSink,
    ) -> Result<Outcome, rootcause::Report> {
        let request = Launch {
            environment: self.environment.clone(),
            branch: self.branch.clone(),
            prompt,
        };
        request.validate()?;
        let session = self.session(id)?;
        let _guard = session
            .turn_lock
            .try_lock()
            .map_err(|_| rootcause::report!("session already has a running prompt"))?;
        session.cancel.store(false, Ordering::SeqCst);
        let previous = session.state.lock().expect("session poisoned").clone();
        if previous.uncertain_write {
            return Err(rootcause::report!(
                "previous submission has an uncertain outcome; inspect cloud tasks before starting another session"
            ));
        }
        if let Some(task) = &previous.task {
            let snapshot = self
                .probe
                .snapshot(&CloudId::new(task.clone())?, unix_now()?)
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
        self.record(
            id,
            &session,
            CloudEvent {
                id: uuid::Uuid::now_v7().to_string(),
                method: "user/message".into(),
                params: serde_json::json!({"text":request.prompt}),
            },
            sink,
        )?;
        {
            let mut state = session.state.lock().expect("session poisoned");
            let mut updated = state.clone();
            updated.uncertain_write = true;
            self.journal.save(id, &updated)?;
            *state = updated;
        }
        let receipt = match (&previous.task, &previous.turn) {
            (Some(task), Some(turn)) => {
                self.probe
                    .follow_up(
                        &CloudId::new(task.clone())?,
                        &TurnId::new(turn.clone())?,
                        &request.prompt,
                        unix_now()?,
                    )
                    .await?
            }
            (None, None) => self.probe.launch(&request, unix_now()?).await?,
            _ => {
                return Err(rootcause::report!(
                    "saved task has no assistant turn; inspect it before continuing"
                ));
            }
        };
        let task = receipt.task_id;
        {
            let mut state = session.state.lock().expect("session poisoned");
            let mut updated = state.clone();
            updated.task = Some(task.as_str().to_owned());
            updated.turn = receipt
                .assistant_turn_id
                .as_ref()
                .map(|turn| turn.as_str().to_owned());
            updated.uncertain_write = updated.turn.is_none();
            self.journal.save(id, &updated)?;
            *state = updated;
        }
        let turn = receipt.assistant_turn_id.ok_or_else(|| {
            rootcause::report!(
                "provider created task without assistant turn; submission will not be retried"
            )
        })?;
        if session.cancel.load(Ordering::SeqCst) {
            self.probe.cancel(&task, unix_now()?).await?;
        }
        let mut stream = self.probe.stream(&task, &turn, unix_now()?).await.ok();
        let mut reconnects = 0_u8;
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        loop {
            tokio::select! {
                event = async { match &mut stream { Some(stream) => stream.next().await, None => std::future::pending().await } } => {
                    match event {
                        Some(Ok(event)) => {
                            self.observe_event(id, &session, &task, event, sink).await?;
                        }
                        Some(Err(_)) | None => { stream = None; }
                    }
                }
                _ = interval.tick() => {
                    let snapshot = self.probe.turn(&task, &turn, unix_now()?).await?;
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
                            if let Ok(mut replay) = self.probe.stream(&task, &turn, unix_now()?).await {
                                let drain = async {
                                    while let Some(Ok(event)) = replay.next().await { self.observe_event(id, &session, &task, event, sink).await?; }
                                    Ok::<(), rootcause::Report>(())
                                };
                                if let Ok(result) = tokio::time::timeout(Duration::from_secs(2), drain).await { result?; }
                            }
                            let history = session.state.lock().expect("session poisoned").history.clone();
                            let events = &history[previous.history.len()..];
                            let streamed: String = events.iter().filter(|event| event.method == "item/agentMessage/delta").filter_map(|event| event.params["delta"].as_str()).collect();
                            for text in snapshot.turns.iter().filter(|turn| turn.source == "current_assistant_turn").flat_map(|turn| &turn.messages) {
                                let represented = events.iter().any(|event| event.method == "item/completed" && event.params["item"]["type"].as_str() == Some("agentMessage") && event.params["item"]["text"].as_str() == Some(text.as_str()));
                                if !represented && !streamed.contains(text) {
                                    let final_text = if streamed.is_empty() { text.clone() } else { format!("\n\nFinal provider output:\n{text}") };
                                    self.record(id, &session, CloudEvent { id: uuid::Uuid::now_v7().to_string(), method: "item/agentMessage/delta".into(), params: serde_json::json!({"delta":final_text}) }, sink)?;
                                }
                            }
                            return Ok(Outcome::Completed);
                        }
                        Some("cancelled") => return Ok(Outcome::Cancelled),
                        Some("failed") => return Err(rootcause::report!("cloud assistant turn failed")),
                        _ => {
                            if stream.is_none() && reconnects < 3 {
                                reconnects += 1;
                                stream = self.probe.stream(&task, &turn, unix_now()?).await.ok();
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
