//! Lifecycle orchestration for active agent sessions.

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::ports::Transport as _;
use agent_session::domain::model::{AgentSessionId, CreateAgentSessionParams};
use agent_session::domain::ports::{AgentSessionLogRepo, AgentSessionRepo};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::{Mutex, mpsc, oneshot};

use crate::domain::agent_sessions::AgentSessionManager;
use crate::domain::containers::ContainerManager;
use crate::domain::error::{HarnessError, Result};

/// Owns active session actors and restores their containers on demand.
pub struct AgentHarnessService<Sessions, Logs, Containers> {
    manager: Arc<AgentSessionManager<Sessions, Logs>>,
    containers: Arc<Containers>,
    registry: Arc<SessionRegistry>,
}

impl<Sessions, Logs, Containers> AgentHarnessService<Sessions, Logs, Containers>
where
    Sessions: AgentSessionRepo,
    Logs: AgentSessionLogRepo + Clone,
    Containers: ContainerManager,
{
    /// Build a harness service from its persistence and container ports.
    pub fn new(sessions: Sessions, logs: Logs, containers: Containers) -> Self {
        Self {
            manager: Arc::new(AgentSessionManager::new(sessions, logs)),
            containers: Arc::new(containers),
            registry: Arc::new(SessionRegistry::default()),
        }
    }

    /// Persist and start a new session, queueing its first action immediately.
    ///
    /// Completes once the action reaches the container transport. Cancelling
    /// the caller does not cancel work already handed to the session actor.
    pub async fn start(
        &self,
        params: CreateAgentSessionParams,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> Result<AgentSessionId> {
        let id = params.id;
        let handle = self.get_or_launch(id, Startup::Start(params)).await;
        handle.send(id, user_id, action).await?;
        Ok(id)
    }

    /// Send an action, automatically restoring the session's container when inactive.
    ///
    /// Completes once the action reaches the container transport. Cancelling
    /// the caller does not cancel work already handed to the session actor.
    pub async fn send(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> Result<()> {
        let handle = self.get_or_launch(id, Startup::Resume(id)).await;
        match handle.send(id, user_id.clone(), action.clone()).await {
            Err(HarnessError::Disconnected(_)) => {
                self.registry.remove(id, handle.generation).await;
                self.get_or_launch(id, Startup::Resume(id))
                    .await
                    .send(id, user_id, action)
                    .await
            }
            result => result,
        }
    }

    async fn get_or_launch(&self, id: AgentSessionId, startup: Startup) -> SessionHandle {
        let mut sessions = self.registry.sessions.lock().await;
        if let Some(handle) = sessions.get(&id).cloned() {
            if !handle.commands.is_closed() {
                return handle;
            }
            sessions.remove(&id);
        }

        let generation = self
            .registry
            .next_generation
            .fetch_add(1, Ordering::Relaxed);
        let (commands, command_rx) = mpsc::channel(32);
        let handle = SessionHandle {
            generation,
            commands,
        };
        sessions.insert(id, handle.clone());
        drop(sessions);

        tokio::spawn(run_session(
            id,
            generation,
            startup,
            self.manager.clone(),
            self.containers.clone(),
            Arc::downgrade(&self.registry),
            command_rx,
        ));

        handle
    }
}

enum Startup {
    Start(CreateAgentSessionParams),
    Resume(AgentSessionId),
}

struct SessionCommand {
    user_id: Option<MacroUserIdStr<'static>>,
    action: AgentAction,
    completed: oneshot::Sender<Result<()>>,
}

#[derive(Clone)]
struct SessionHandle {
    generation: u64,
    commands: mpsc::Sender<SessionCommand>,
}

impl SessionHandle {
    async fn send(
        &self,
        id: AgentSessionId,
        user_id: Option<MacroUserIdStr<'static>>,
        action: AgentAction,
    ) -> Result<()> {
        let (completed, result) = oneshot::channel();
        self.commands
            .send(SessionCommand {
                user_id,
                action,
                completed,
            })
            .await
            .map_err(|_| HarnessError::Disconnected(id))?;
        result.await.map_err(|_| HarnessError::Disconnected(id))?
    }
}

#[derive(Default)]
struct SessionRegistry {
    sessions: Mutex<HashMap<AgentSessionId, SessionHandle>>,
    next_generation: AtomicU64,
}

impl SessionRegistry {
    async fn remove(&self, id: AgentSessionId, generation: u64) {
        let mut sessions = self.sessions.lock().await;
        if sessions.get(&id).map(|handle| handle.generation) == Some(generation) {
            sessions.remove(&id);
        }
    }
}

async fn run_session<Sessions, Logs, Containers>(
    id: AgentSessionId,
    generation: u64,
    startup: Startup,
    manager: Arc<AgentSessionManager<Sessions, Logs>>,
    containers: Arc<Containers>,
    registry: std::sync::Weak<SessionRegistry>,
    mut commands: mpsc::Receiver<SessionCommand>,
) where
    Sessions: AgentSessionRepo,
    Logs: AgentSessionLogRepo + Clone,
    Containers: ContainerManager,
{
    let setup = async {
        let (record, container) = match startup {
            Startup::Start(params) => {
                let record = manager.create(params).await?;
                let container = containers.spawn(record.id).await?;
                (record, container)
            }
            Startup::Resume(id) => {
                let record = manager.get(id).await?;
                let container = containers.resume(id).await?;
                (record, container)
            }
        };
        let receiver = container.clone();
        Ok::<_, HarnessError>((manager.plug(record.id, container), receiver))
    }
    .await;

    let (mut session, receiver) = match setup {
        Ok(session) => session,
        Err(error) => {
            commands.close();
            remove_session(&registry, id, generation).await;
            fail_pending(commands, error).await;
            return;
        }
    };

    // A physical receive is never raced against commands. Some transports are
    // not cancellation-safe, so one task owns each in-flight receive until it
    // completes and forwards the result through a cancellation-safe channel.
    let (inbound_tx, mut inbound_rx) = mpsc::channel(32);
    let receiver_task = tokio::spawn(async move {
        loop {
            let inbound = receiver.recv().await.map_err(HarnessError::from);
            let finished = matches!(inbound, Ok(None) | Err(_));
            if inbound_tx.send(inbound).await.is_err() || finished {
                break;
            }
        }
    });
    let mut waiting_for_delivery = Vec::new();

    loop {
        enum RuntimeEvent {
            Command(Option<SessionCommand>),
            Inbound(Result<Option<agent_runtime_protocol::domain::schema::v0::ToServerMessage>>),
        }

        let event = tokio::select! {
            command = commands.recv() => RuntimeEvent::Command(command),
            inbound = inbound_rx.recv() => RuntimeEvent::Inbound(inbound.unwrap_or(Ok(None))),
        };

        let keep_running = match event {
            RuntimeEvent::Command(Some(command)) => {
                let result = session.send_message(command.user_id, command.action).await;
                let keep_running = result.is_ok();
                if !keep_running {
                    commands.close();
                    remove_session(&registry, id, generation).await;
                }
                match result {
                    Ok(()) if session.pending().is_empty() => {
                        let _ = command.completed.send(Ok(()));
                    }
                    Ok(()) => waiting_for_delivery.push(command.completed),
                    Err(error) => {
                        let message = error.to_string();
                        let _ = command.completed.send(Err(error));
                        fail_deliveries(&mut waiting_for_delivery, &message);
                    }
                }
                keep_running
            }
            RuntimeEvent::Command(None) => {
                fail_deliveries(&mut waiting_for_delivery, "agent harness service stopped");
                false
            }
            RuntimeEvent::Inbound(Ok(None)) => {
                fail_deliveries(&mut waiting_for_delivery, "agent container disconnected");
                false
            }
            RuntimeEvent::Inbound(Ok(Some(message))) => {
                let pending_before = session.pending().len();
                let handled = session.handle_inbound(message).await;
                let delivered = pending_before.saturating_sub(session.pending().len());
                complete_deliveries(&mut waiting_for_delivery, delivered);

                if let Err(error) = handled {
                    tracing::error!(error = ?error, %id, "agent session failed handling inbound message");
                    fail_deliveries(&mut waiting_for_delivery, &error.to_string());
                    false
                } else {
                    if session.pending().is_empty() {
                        for completed in waiting_for_delivery.drain(..) {
                            let _ = completed.send(Ok(()));
                        }
                    }
                    true
                }
            }
            RuntimeEvent::Inbound(Err(error)) => {
                tracing::error!(error = ?error, %id, "agent session transport failed");
                fail_deliveries(&mut waiting_for_delivery, &error.to_string());
                false
            }
        };

        if !keep_running {
            break;
        }
    }

    commands.close();
    remove_session(&registry, id, generation).await;
    receiver_task.abort();
}

async fn remove_session(
    registry: &std::sync::Weak<SessionRegistry>,
    id: AgentSessionId,
    generation: u64,
) {
    if let Some(registry) = registry.upgrade() {
        registry.remove(id, generation).await;
    }
}

async fn fail_pending(mut commands: mpsc::Receiver<SessionCommand>, error: HarnessError) {
    let message = error.to_string();
    let mut first = Some(error);
    while let Some(command) = commands.recv().await {
        let error = first
            .take()
            .unwrap_or_else(|| HarnessError::Container(message.clone()));
        let _ = command.completed.send(Err(error));
    }
}

fn fail_deliveries(waiting: &mut Vec<oneshot::Sender<Result<()>>>, message: &str) {
    for completed in waiting.drain(..) {
        let _ = completed.send(Err(HarnessError::Container(message.to_owned())));
    }
}

fn complete_deliveries(waiting: &mut Vec<oneshot::Sender<Result<()>>>, count: usize) {
    let delivered = count.min(waiting.len());
    for completed in waiting.drain(..delivered) {
        let _ = completed.send(Ok(()));
    }
}
