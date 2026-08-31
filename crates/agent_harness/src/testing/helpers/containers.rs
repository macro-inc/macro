//! In-memory container and provisioner test doubles.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::ports::{
    Transport, TransportError, TransportReceiver, TransportSender,
};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use agent_session::domain::model::{AgentSessionId, SandboxSize};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::SpawnContainer;
use crate::domain::ports::ContainerManager;
use crate::domain::sandbox::{SandboxResizeEffect, create_only_resize_effect, resize_effect};
use crate::testing::helpers::agent::FakeAgent;

/// A container connection driven by hand.
///
/// Wraps its agent's raw ACP frames in the envelope and originates lifecycle
/// events itself, as the real adapter does. `recv` awaits, so a forgotten
/// enqueue hangs rather than looking like a closed stream; only
/// [`Self::disconnects`] ends it. Cloning shares one container.
#[derive(Clone)]
pub struct ContainerMock {
    agent: FakeAgent,
    /// `None` once disconnected.
    events: Arc<Mutex<Option<UnboundedSender<SystemEvent>>>>,
    inbound: Arc<tokio::sync::Mutex<Inbound>>,
    outbound: Arc<Mutex<Vec<ToRuntimeMessage>>>,
    /// Sends still allowed before this container starts refusing them.
    send_budget: Arc<Mutex<Option<usize>>>,
}

impl Default for ContainerMock {
    fn default() -> Self {
        let (event_tx, event_rx) = unbounded_channel();
        let (frame_tx, frame_rx) = unbounded_channel();

        Self {
            agent: FakeAgent::new(frame_tx),
            events: Arc::new(Mutex::new(Some(event_tx))),
            inbound: Arc::new(tokio::sync::Mutex::new(Inbound {
                events: event_rx,
                frames: frame_rx,
            })),
            outbound: Arc::new(Mutex::new(Vec::new())),
            send_budget: Arc::new(Mutex::new(None)),
        }
    }
}

/// The receiving ends, held together so `recv` can await both at once.
struct Inbound {
    events: UnboundedReceiver<SystemEvent>,
    frames: UnboundedReceiver<RawJsonRpcMessage>,
}

impl ContainerMock {
    /// The agent hosted in this container.
    #[must_use]
    pub fn agent(&self) -> FakeAgent {
        self.agent.clone()
    }

    /// The sidecar came up and the agent's ACP channel is wired end to end.
    pub fn sends_ready(&self) {
        self.sends_event(SystemEvent::AcpReady);
    }

    /// Report a lifecycle event.
    pub fn sends_event(&self, event: SystemEvent) {
        if let Some(events) = self
            .events
            .lock()
            .expect("container mock events lock should not be poisoned")
            .as_ref()
        {
            events
                .send(event)
                .expect("container mock events channel should not be closed");
        }
    }

    /// Let `count` more sends succeed, then refuse every send after that.
    pub fn fails_sends_after(&self, count: usize) {
        *self
            .send_budget
            .lock()
            .expect("container mock send budget lock should not be poisoned") = Some(count);
    }

    /// End the connection, as a stopped or archived sandbox does.
    pub fn disconnects(&self) {
        self.events
            .lock()
            .expect("container mock events lock should not be poisoned")
            .take();
        self.agent.close();
    }

    /// Every envelope the harness sent, in order.
    #[must_use]
    pub fn sent(&self) -> Vec<ToRuntimeMessage> {
        self.outbound
            .lock()
            .expect("container mock outbound lock should not be poisoned")
            .clone()
    }
}

/// A [`ContainerMock`]'s sending half. Shares the mock's recorded state, so a
/// test still observes sends through the mock it kept.
pub struct ContainerSender {
    agent: FakeAgent,
    outbound: Arc<Mutex<Vec<ToRuntimeMessage>>>,
    send_budget: Arc<Mutex<Option<usize>>>,
}

/// A [`ContainerMock`]'s receiving half.
pub struct ContainerReceiver {
    inbound: Arc<tokio::sync::Mutex<Inbound>>,
}

impl Transport<ToRuntimeMessage, ToServerMessage> for ContainerMock {
    type Sender = ContainerSender;
    type Receiver = ContainerReceiver;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (
            ContainerSender {
                agent: self.agent,
                outbound: self.outbound,
                send_budget: self.send_budget,
            },
            ContainerReceiver {
                inbound: self.inbound,
            },
        )
    }
}

impl TransportSender<ToRuntimeMessage> for ContainerSender {
    async fn send(&self, message: ToRuntimeMessage) -> Result<(), TransportError> {
        if let Some(budget) = self
            .send_budget
            .lock()
            .expect("container mock send budget lock should not be poisoned")
            .as_mut()
        {
            if *budget == 0 {
                return Err(TransportError::Client(
                    "sandbox stopped accepting sends".to_owned(),
                ));
            }
            *budget -= 1;
        }

        self.outbound
            .lock()
            .expect("container mock outbound lock should not be poisoned")
            .push(message.clone());

        if let ToRuntimeMessage::Acp(AcpMessage(frame)) = message {
            self.agent.deliver(frame);
        }

        Ok(())
    }
}

impl TransportReceiver<ToServerMessage> for ContainerReceiver {
    async fn recv(&mut self) -> Result<Option<ToServerMessage>, TransportError> {
        let mut inbound = self.inbound.lock().await;
        let Inbound { events, frames } = &mut *inbound;

        tokio::select! {
            Some(event) = events.recv() => {
                Ok(Some(ToServerMessage::Event { event }))
            }
            Some(frame) = frames.recv() => {
                Ok(Some(ToServerMessage::Acp(AcpMessage(frame))))
            }
            else => Ok(None),
        }
    }
}

/// Hands out [`ContainerMock`]s and remembers them. Resuming preserves the
/// logical sandbox but replaces its disconnected transport.
#[derive(Clone, Default)]
pub struct MockContainerManager {
    containers: Arc<Mutex<HashMap<AgentSessionId, ContainerMock>>>,
    spawn_error: Arc<Mutex<Option<String>>>,
    spawn_sizes: Arc<Mutex<Vec<SandboxSize>>>,
    resizes: Arc<Mutex<Vec<(AgentSessionId, SandboxSize)>>>,
    resize_unsupported: Arc<AtomicBool>,
    resumes: Arc<AtomicUsize>,
    teardowns: Arc<AtomicUsize>,
}

impl MockContainerManager {
    /// Create a provisioner that has spawned nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The container this session was given, so a test can drive it.
    #[must_use]
    pub fn container(&self, session: AgentSessionId) -> Option<ContainerMock> {
        self.lock().get(&session).cloned()
    }

    /// Every session a container has been spawned for.
    #[must_use]
    pub fn sessions(&self) -> Vec<AgentSessionId> {
        self.lock().keys().copied().collect()
    }

    /// How many sandboxes have been booted.
    #[must_use]
    pub fn spawned(&self) -> usize {
        self.lock().len()
    }

    /// Make the next sandbox spawn fail with `message`.
    pub fn fail_next_spawn(&self, message: impl Into<String>) {
        *self
            .spawn_error
            .lock()
            .expect("spawn error lock should not be poisoned") = Some(message.into());
    }

    /// How many times an existing sandbox was requested.
    #[must_use]
    pub fn resumed(&self) -> usize {
        self.resumes.load(Ordering::Relaxed)
    }

    /// How many sandboxes have been destroyed.
    #[must_use]
    pub fn torn_down(&self) -> usize {
        self.teardowns.load(Ordering::Relaxed)
    }

    /// Sizes requested at spawn, in order.
    #[must_use]
    pub fn spawn_sizes(&self) -> Vec<SandboxSize> {
        self.spawn_sizes
            .lock()
            .expect("spawn sizes lock should not be poisoned")
            .clone()
    }

    /// Resize requests, in order.
    #[must_use]
    pub fn resizes(&self) -> Vec<(AgentSessionId, SandboxSize)> {
        self.resizes
            .lock()
            .expect("resizes lock should not be poisoned")
            .clone()
    }

    /// Report [`SandboxResizeEffect::Unsupported`] for any real size change.
    pub fn refuse_resize(&self) {
        self.resize_unsupported.store(true, Ordering::Relaxed);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<AgentSessionId, ContainerMock>> {
        self.containers
            .lock()
            .expect("container manager mock lock should not be poisoned")
    }
}

impl ContainerManager for MockContainerManager {
    type Transport = ContainerMock;

    async fn spawn(&self, command: SpawnContainer) -> Result<ContainerMock, HarnessError> {
        if let Some(message) = self
            .spawn_error
            .lock()
            .expect("spawn error lock should not be poisoned")
            .take()
        {
            return Err(HarnessError::Container(message));
        }
        self.spawn_sizes
            .lock()
            .expect("spawn sizes lock should not be poisoned")
            .push(command.size);
        let container = ContainerMock::default();
        self.lock().insert(command.session_id, container.clone());
        Ok(container)
    }

    fn resize_effect(&self, from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
        if self.resize_unsupported.load(Ordering::Relaxed) {
            create_only_resize_effect(from, to)
        } else {
            resize_effect(from, to)
        }
    }

    async fn resize(&self, session: AgentSessionId, size: SandboxSize) -> Result<(), HarnessError> {
        if !self.lock().contains_key(&session) {
            return Err(HarnessError::Container(format!(
                "no sandbox was ever spawned for {session}"
            )));
        }
        if self.resize_unsupported.load(Ordering::Relaxed) {
            return Err(HarnessError::Container(
                "this container manager cannot resize a live sandbox".to_owned(),
            ));
        }
        self.resizes
            .lock()
            .expect("resizes lock should not be poisoned")
            .push((session, size));
        Ok(())
    }

    async fn resume(&self, session: AgentSessionId) -> Result<ContainerMock, HarnessError> {
        self.resumes.fetch_add(1, Ordering::Relaxed);
        let mut containers = self.lock();
        if !containers.contains_key(&session) {
            return Err(HarnessError::Container(format!(
                "no sandbox was ever spawned for {session}"
            )));
        }
        let container = ContainerMock::default();
        containers.insert(session, container.clone());
        Ok(container)
    }

    /// The fixed token every mock container "holds", for sessions that were
    /// spawned; `None` otherwise, like a provider that finds no container.
    async fn session_token(&self, session: AgentSessionId) -> Result<Option<String>, HarnessError> {
        Ok(self
            .lock()
            .contains_key(&session)
            .then(|| "test-session-token".to_owned()))
    }

    async fn teardown(&self, session: AgentSessionId) -> Result<(), HarnessError> {
        self.teardowns.fetch_add(1, Ordering::Relaxed);
        self.lock().remove(&session);
        Ok(())
    }
}
