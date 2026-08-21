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
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::{mpsc, oneshot, watch};

use crate::domain::error::Result;
use crate::domain::model::{AgentSessionId, AgentSessionLog, Message};
use agent_runtime_protocol::domain::ports::{TransportReceiver, TransportSender};

use crate::domain::ports::{AgentConnector, AgentSessionLogWriter, AgentSessionRepo};

use super::{CloseReason, Effect, HandshakeStatus, Input, SessionMachine};

/// A caller's request to deliver one action, and the wire back to them.
pub(crate) struct SessionCommand {
    pub(crate) user_id: Option<MacroUserIdStr<'static>>,
    pub(crate) action: AgentAction,
    pub(crate) action_id: AgentActionId,
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
pub(crate) struct SessionActor<Connector: AgentConnector, Logs> {
    machine: SessionMachine<oneshot::Sender<Result<()>>>,
    /// The carrier's halves. Sending is shared with whoever else is on the
    /// same connection; receiving is this actor's alone, which is why it can
    /// be read with `&mut` and needs no lock.
    outbound: Connector::Sender,
    inbound: Connector::Receiver,
    logs: Logs,
    commands: mpsc::Receiver<SessionCommand>,
    /// This connection's handshake gate: published to when this session runs
    /// the handshake, watched for when another session runs it.
    handshake: watch::Sender<HandshakeStatus>,
    handshake_seen: watch::Receiver<HandshakeStatus>,
}

impl<Connector, Logs> SessionActor<Connector, Logs>
where
    Connector: AgentConnector,
    Logs: AgentSessionLogWriter + AgentSessionRepo,
{
    pub(crate) fn new(
        id: AgentSessionId,
        acp_session_id: Option<SessionId>,
        workspace: String,
        connector: Connector,
        logs: Logs,
        commands: mpsc::Receiver<SessionCommand>,
        handshake: watch::Sender<HandshakeStatus>,
    ) -> Self {
        // Marked unseen so the first wait reports the *current* state rather
        // than only later changes: a session binding after the handshake
        // finished would otherwise wait for an announcement already made.
        let mut handshake_seen = handshake.subscribe();
        handshake_seen.mark_changed();

        let (outbound, inbound) = connector.split();

        Self {
            outbound,
            inbound,
            handshake_seen,
            handshake,
            machine: match acp_session_id {
                None => SessionMachine::new(id, workspace),
                Some(session_id) => SessionMachine::resume(id, session_id, workspace),
            },
            logs,
            commands,
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
                Some(SessionCommand { user_id, action, action_id, completed }) => Input::Command {
                    from: user_id,
                    action,
                    action_id,
                    token: completed,
                },
                // The service dropped every handle; nobody can reach us.
                None => Input::Closed(CloseReason::Abandoned),
            },
            // A handshake somebody else ran. The machine ignores it unless it
            // is still booting, which is what makes the session that ran the
            // handshake ignore its own result coming back.
            Ok(()) = self.handshake_seen.changed() => match *self.handshake_seen.borrow_and_update() {
                HandshakeStatus::Ready(restore) => Input::Ready { restore },
                // Nothing to act on yet, but the wait must resume.
                HandshakeStatus::Pending | HandshakeStatus::InFlight => return Stepped::Continue,
            },
            inbound = self.inbound.recv() => match inbound {
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
                Effect::Initialized { restore } => {
                    // Nothing waits on this today; a failed send would mean
                    // every receiver is gone, which cannot happen while this
                    // actor holds one.
                    let _ = self.handshake.send(HandshakeStatus::Ready(restore));
                }
                Effect::Complete { token, result } => {
                    let _ = token.send(result);
                }
                Effect::Stop { reason } => {
                    self.log(
                        None,
                        Message::ToServer(ToServerMessage::Event {
                            event: SystemEvent::Disconnected,
                        }),
                    )
                    .await
                    .inspect_err(|error| {
                        tracing::error!(
                            error = ?error,
                            id = %self.machine.id(),
                            "agent session failed to persist its disconnect"
                        );
                    })
                    .ok();
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
        &mut self,
        from: Option<MacroUserIdStr<'static>>,
        message: ToRuntimeMessage,
    ) -> Result<()> {
        self.log(from, Message::ToRuntime(message.clone())).await?;
        self.outbound.send(message).await?;
        Ok(())
    }

    async fn log(
        &mut self,
        user_id: Option<MacroUserIdStr<'static>>,
        content: Message,
    ) -> Result<()> {
        self.logs
            .append(AgentSessionLog {
                agent_session_id: self.machine.id(),
                user_id,
                content,
            })
            .await
    }

    async fn persist_acp_session(&self, acp_session_id: SessionId) -> Result<()> {
        self.logs
            .set_acp_session_id(self.machine.id(), acp_session_id)
            .await
    }
}
