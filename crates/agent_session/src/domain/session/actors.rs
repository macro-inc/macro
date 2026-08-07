//! The imperative shell around [`SessionMachine`]: executes one input's
//! effects at a time.
//!
//! [`SessionActor`] owns the machine, the transport, and the log handle for
//! one connection. It never decides anything - it pulls one input, hands it
//! to the machine, and executes the returned effects in order. An effect that
//! fails to execute voids the rest of its batch and feeds [`Input::Closed`]
//! back into the machine, so a `Complete` never fires for an action that was
//! not sent.
//!
//! Stepping is the caller's choice: production spawns a "step until stopped"
//! loop (see [`super::super::service`]), while a test can construct an actor
//! and crank it by hand - after every [`SessionActor::step`] the world has
//! fully caught up with that input.

use std::collections::VecDeque;

use agent_client_protocol::schema::v1::SessionId;
use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::ports::TransportError;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::{mpsc, oneshot};

use crate::domain::error::Result;
use crate::domain::model::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::ports::{AgentConnector, AgentSessionLogRepo, AgentSessionRepo};

use super::{CloseReason, Effect, Input, SessionMachine};

/// Buffered inbound messages between the receive pump and the actor select.
const INBOUND_BUFFER: usize = 1028;

/// A caller's request to deliver one action, and the wire back to them.
pub(crate) struct SessionCommand {
    pub(crate) user_id: Option<MacroUserIdStr<'static>>,
    pub(crate) action: AgentAction,
    pub(crate) completed: oneshot::Sender<Result<()>>,
}

/// Whether a [`SessionActor`] has more steps to take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stepped {
    /// Keep stepping.
    Continue,
    /// The machine stopped; clean up.
    Stopped,
}

/// One session connection's imperative shell: pulls one input, runs the
/// machine, and executes the effects - nothing else.
pub(crate) struct SessionActor<Connector, Logs> {
    machine: SessionMachine<oneshot::Sender<Result<()>>>,
    connector: Connector,
    logs: Logs,
    commands: mpsc::Receiver<SessionCommand>,
    inbound: mpsc::Receiver<std::result::Result<Option<ToServerMessage>, TransportError>>,
    /// The task owning the in-flight physical receive; aborted when this
    /// actor drops.
    pump: tokio::task::JoinHandle<()>,
}

impl<Connector, Logs> SessionActor<Connector, Logs>
where
    Connector: AgentConnector + Clone,
    Logs: AgentSessionLogRepo + AgentSessionRepo,
{
    pub(crate) fn new(
        id: AgentSessionId,
        acp_session_id: Option<SessionId>,
        connector: Connector,
        logs: Logs,
        commands: mpsc::Receiver<SessionCommand>,
    ) -> Self {
        // Keep one physical receive alive independently of the actor select.
        // Some transports are not cancellation-safe.
        let (inbound_tx, inbound) = mpsc::channel(INBOUND_BUFFER);
        let receiver = connector.clone();
        let pump = tokio::spawn(async move {
            loop {
                let inbound = receiver.recv().await;
                let finished = matches!(inbound, Ok(None) | Err(_));
                if inbound_tx.send(inbound).await.is_err() || finished {
                    break;
                }
            }
        });

        Self {
            machine: acp_session_id.map_or_else(
                || SessionMachine::new(id),
                |session_id| SessionMachine::resume(id, session_id),
            ),
            connector,
            logs,
            commands,
            inbound,
            pump,
        }
    }

    /// The session this actor's connection belongs to.
    pub(crate) fn id(&self) -> AgentSessionId {
        self.machine.id()
    }

    /// Refuse further commands, so a caller cannot enqueue into an actor that
    /// will never step again.
    pub(crate) fn close(&mut self) {
        self.commands.close();
    }

    /// Wait for one input and execute every effect it produces.
    pub(crate) async fn step(&mut self) -> Stepped {
        let input = tokio::select! {
            command = self.commands.recv() => match command {
                Some(SessionCommand { user_id, action, completed }) => Input::Command {
                    from: user_id,
                    action,
                    token: completed,
                },
                // The service dropped every handle; nobody can reach us.
                None => Input::Closed(CloseReason::Abandoned),
            },
            inbound = self.inbound.recv() => match inbound.unwrap_or(Ok(None)) {
                Ok(Some(message)) => Input::Inbound(message),
                Ok(None) => Input::Closed(CloseReason::TransportClosed),
                Err(error) => {
                    tracing::error!(error = ?error, id = %self.machine.id(), "agent session transport failed");
                    Input::Closed(CloseReason::TransportFailed)
                }
            },
        };

        self.dispatch(input).await
    }

    /// Run the machine and execute its effects in order. An effect that fails
    /// to execute voids the rest of its batch and feeds [`Input::Closed`]
    /// back in - so a `Complete` never fires for an action that was not sent,
    /// and the machine (not this loop) decides what failure means.
    async fn dispatch(&mut self, input: Input<oneshot::Sender<Result<()>>>) -> Stepped {
        let mut effects = VecDeque::from(self.machine.handle(input));
        let mut stepped = Stepped::Continue;

        while let Some(effect) = effects.pop_front() {
            match effect {
                Effect::Send { from, message } => {
                    if let Err(error) = self.deliver(from, message).await {
                        tracing::error!(
                            error = ?error,
                            id = %self.machine.id(),
                            "agent session failed to deliver an action"
                        );
                        if let Some(Effect::Complete { token, .. }) = effects.pop_front() {
                            let _ = token.send(Err(error));
                        }
                        effects.clear();
                        effects.extend(self.machine.handle(Input::Closed(CloseReason::SendFailed)));
                    }
                }
                Effect::Log { message } => {
                    if let Err(error) = self.log(None, Message::ToServer(message)).await {
                        tracing::error!(
                            error = ?error,
                            id = %self.machine.id(),
                            "agent session failed to persist an inbound message"
                        );
                        effects.clear();
                        effects.extend(self.machine.handle(Input::Closed(CloseReason::LogFailed)));
                    }
                }
                Effect::PersistAcpSession { session_id } => {
                    if let Err(error) = self.persist_acp_session(session_id).await {
                        tracing::error!(
                            error = ?error,
                            id = %self.machine.id(),
                            "agent session failed to persist its ACP session id"
                        );
                        effects.clear();
                        effects.extend(self.machine.handle(Input::Closed(CloseReason::LogFailed)));
                    }
                }
                Effect::Complete { token, result } => {
                    let _ = token.send(result);
                }
                Effect::Stop { reason } => {
                    tracing::info!(id = %self.machine.id(), %reason, "agent session stopped");
                    stepped = Stepped::Stopped;
                }
            }
        }

        stepped
    }

    /// Log then send: the log entry is written first so the session's history
    /// never lacks a message its agent received.
    async fn deliver(
        &self,
        from: Option<MacroUserIdStr<'static>>,
        message: ToRuntimeMessage,
    ) -> Result<()> {
        self.log(from, Message::ToRuntime(message.clone())).await?;
        self.connector.send(message).await?;
        Ok(())
    }

    async fn log(&self, user_id: Option<MacroUserIdStr<'static>>, content: Message) -> Result<()> {
        AgentSessionLogRepo::create(
            &self.logs,
            AgentSessionLog {
                agent_session_id: self.machine.id(),
                user_id,
                content,
            },
        )
        .await
    }

    async fn persist_acp_session(&self, acp_session_id: SessionId) -> Result<()> {
        self.logs
            .set_acp_session_id(self.machine.id(), acp_session_id)
            .await
    }
}

/// Abort the receiver pump when the actor goes away, however it goes away.
impl<Connector, Logs> Drop for SessionActor<Connector, Logs> {
    fn drop(&mut self) {
        self.pump.abort();
    }
}
