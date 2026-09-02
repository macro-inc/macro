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
//! loop (see [`super::super::service`]), while tests exercise its input and
//! dispatch halves directly.

use std::{collections::VecDeque, time::Duration};

use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::{McpServer, SessionId};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;
use tracing::Instrument as _;

use crate::domain::error::{AgentSessionError, Result};
use crate::domain::model::{AgentSessionId, AgentSessionLog, Message};
use agent_runtime_protocol::domain::ports::{TransportReceiver, TransportSender};

use crate::domain::ports::{AgentConnector, AgentSessionLogWriter, AgentSessionRepo};

use super::{CloseReason, Effect, HandshakeStatus, Input, RuntimeStatus, SessionMachine};

/// How long the ACP handshake has to finish before the session is declared dead.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(60);
/// How long one caller's action has to reach the runtime.
const COMMAND_DELIVERY_TIMEOUT: Duration = Duration::from_secs(60);

/// A caller's request to deliver one action, and the wire back to them.
pub(crate) struct SessionCommand {
    pub(crate) user_id: Option<MacroUserIdStr<'static>>,
    pub(crate) action: AgentAction,
    pub(crate) action_id: AgentActionId,
    pub(crate) completed: oneshot::Sender<Result<()>>,
    pub(crate) span: tracing::Span,
    pub(crate) enqueued_at: Instant,
}

pub(crate) struct SessionCompletion {
    completed: oneshot::Sender<Result<()>>,
    span: tracing::Span,
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
    machine: SessionMachine<SessionCompletion>,
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
    /// The span covering the handshake, dropped once the runtime is live or
    /// dead. Every effect run before then hangs off it.
    handshake_span: Option<tracing::Span>,
    handshake_deadline: Instant,
}

impl<Connector, Logs> SessionActor<Connector, Logs>
where
    Connector: AgentConnector,
    Logs: AgentSessionLogWriter + AgentSessionRepo,
{
    // One argument per fact the actor owns; a struct here would only move the
    // same list one level down.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        id: AgentSessionId,
        acp_session_id: Option<SessionId>,
        workspace: String,
        mcp_servers: Vec<McpServer>,
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
        let handshake_span = tracing::info_span!(
            "agent.acp.handshake",
            agent.session.id = %id,
            otel.status_code = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );

        Self {
            outbound,
            inbound,
            handshake_seen,
            handshake,
            machine: match acp_session_id {
                None => SessionMachine::new(id, workspace, mcp_servers),
                Some(session_id) => SessionMachine::resume(id, session_id, workspace, mcp_servers),
            },
            logs,
            commands,
            handshake_span: Some(handshake_span),
            handshake_deadline: Instant::now() + HANDSHAKE_TIMEOUT,
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

    /// Wait for the next input without mutating protocol state. Keeping this
    /// separate from dispatch lets shutdown cancel the wait, never an effect
    /// batch after the machine has already advanced.
    pub(crate) async fn next_input(&mut self) -> Input<SessionCompletion> {
        loop {
            let handshake_deadline = self.handshake_deadline;
            let handshake_timeout = async {
                if matches!(
                    self.machine.status(),
                    RuntimeStatus::Booting | RuntimeStatus::Handshaking
                ) {
                    tokio::time::sleep_until(handshake_deadline).await;
                } else {
                    std::future::pending::<()>().await;
                }
            };
            let input = tokio::select! {
            () = handshake_timeout => Input::Closed(CloseReason::HandshakeTimedOut),
            command = self.commands.recv() => match command {
                Some(SessionCommand { user_id, action, action_id, completed, span, enqueued_at }) => {
                    span.record(
                        "agent.command.queue_wait_ms",
                        enqueued_at.elapsed().as_millis() as u64,
                    );
                    span.record(
                        "agent.session.runtime_phase_at_dequeue",
                        self.machine.status().as_ref(),
                    );
                    Input::Command {
                        from: user_id,
                        action,
                        action_id,
                        token: SessionCompletion { completed, span },
                    }
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
                HandshakeStatus::Pending | HandshakeStatus::InFlight => continue,
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
            return input;
        }
    }

    /// Run the machine and execute its effects in order. An effect that fails
    /// to execute voids the rest of its batch and feeds [`Input::Closed`]
    /// back in - so a `Complete` never fires for an action that was not sent,
    /// and the machine (not this loop) decides what failure means.
    pub(crate) async fn dispatch(&mut self, input: Input<SessionCompletion>) -> Stepped {
        let handshake_deadline = self.handshake_deadline;
        let mut handshake_span = self.handshake_span.clone();
        let produced = match &handshake_span {
            Some(span) => span.in_scope(|| self.machine.handle(input)),
            None => self.machine.handle(input),
        };
        let mut effects = VecDeque::from(produced);
        self.finish_handshake_if_complete();
        if self.handshake_span.is_none() {
            handshake_span = None;
        }
        let mut stepped = Stepped::Continue;

        while let Some(effect) = effects.pop_front() {
            match effect {
                Effect::Send { from, message } => {
                    let command_span = effects.front().and_then(|effect| match effect {
                        Effect::Complete { token, .. } => Some(token.span.clone()),
                        _ => None,
                    });
                    let delivery = self.deliver(from, message);
                    let (result, close_reason) =
                        match (command_span.as_ref(), handshake_span.as_ref()) {
                            (Some(span), _) => match tokio::time::timeout(
                                COMMAND_DELIVERY_TIMEOUT,
                                delivery.instrument(span.clone()),
                            )
                            .await
                            {
                                Ok(result) => (result, CloseReason::SendFailed),
                                Err(_) => (
                                    Err(AgentSessionError::DeliveryTimedOut(self.machine.id())),
                                    CloseReason::SendFailed,
                                ),
                            },
                            (None, Some(span)) => match tokio::time::timeout_at(
                                handshake_deadline,
                                delivery.instrument(span.clone()),
                            )
                            .await
                            {
                                Ok(result) => (result, CloseReason::SendFailed),
                                Err(_) => (
                                    Err(AgentSessionError::Handshake(format!(
                                        "timed out after {} seconds",
                                        HANDSHAKE_TIMEOUT.as_secs()
                                    ))),
                                    CloseReason::HandshakeTimedOut,
                                ),
                            },
                            (None, None) => {
                                match tokio::time::timeout(COMMAND_DELIVERY_TIMEOUT, delivery).await
                                {
                                    Ok(result) => (result, CloseReason::SendFailed),
                                    Err(_) => (
                                        Err(AgentSessionError::DeliveryTimedOut(self.machine.id())),
                                        CloseReason::SendFailed,
                                    ),
                                }
                            }
                        };
                    if let Err(error) = result {
                        if let Some(span) = command_span {
                            span.record("otel.status_code", "ERROR");
                            span.record("otel.status_description", tracing::field::display(&error));
                        }
                        tracing::error!(
                            error = ?error,
                            id = %self.machine.id(),
                            "agent session failed to deliver an action"
                        );
                        self.fail_remaining_completions(&mut effects, error);
                        effects.extend(self.machine.handle(Input::Closed(close_reason)));
                        self.finish_handshake_if_complete();
                    }
                }
                Effect::Log { message } => {
                    let log = self.log(None, Message::ToServer(message));
                    let (result, close_reason) = match handshake_span.as_ref() {
                        Some(span) => match tokio::time::timeout_at(
                            handshake_deadline,
                            log.instrument(span.clone()),
                        )
                        .await
                        {
                            Ok(result) => (result, CloseReason::LogFailed),
                            Err(_) => (
                                Err(AgentSessionError::Handshake(format!(
                                    "timed out after {} seconds",
                                    HANDSHAKE_TIMEOUT.as_secs()
                                ))),
                                CloseReason::HandshakeTimedOut,
                            ),
                        },
                        None => match tokio::time::timeout(COMMAND_DELIVERY_TIMEOUT, log).await {
                            Ok(result) => (result, CloseReason::LogFailed),
                            Err(_) => (
                                Err(AgentSessionError::LogTimedOut(self.machine.id())),
                                CloseReason::LogFailed,
                            ),
                        },
                    };
                    if let Err(error) = result {
                        tracing::error!(
                            error = ?error,
                            id = %self.machine.id(),
                            "agent session failed to persist an inbound message"
                        );
                        self.fail_remaining_completions(&mut effects, error);
                        effects.extend(self.machine.handle(Input::Closed(close_reason)));
                        self.finish_handshake_if_complete();
                    }
                }
                Effect::PersistAcpSession { session_id } => {
                    let result = tokio::time::timeout(
                        COMMAND_DELIVERY_TIMEOUT,
                        self.persist_acp_session(session_id),
                    )
                    .await
                    .unwrap_or_else(|_| Err(AgentSessionError::LogTimedOut(self.machine.id())));
                    if let Err(error) = result {
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
                    if let Err(error) = &result {
                        token.span.record("otel.status_code", "ERROR");
                        token
                            .span
                            .record("otel.status_description", tracing::field::display(error));
                    }
                    let _ = token.completed.send(result);
                }
                Effect::Stop { reason } => {
                    let terminal_log = self.log(
                        None,
                        Message::ToServer(ToServerMessage::Event {
                            event: SystemEvent::Disconnected,
                        }),
                    );
                    let result = tokio::time::timeout(COMMAND_DELIVERY_TIMEOUT, terminal_log).await;
                    match result {
                        Ok(Ok(())) => {}
                        Ok(Err(error)) => {
                            tracing::error!(
                                error = ?error,
                                id = %self.machine.id(),
                                "agent session failed to persist its disconnect"
                            );
                        }
                        Err(_) => {
                            tracing::error!(
                                id = %self.machine.id(),
                                "agent session timed out persisting its disconnect"
                            );
                        }
                    }
                    tracing::info!(id = %self.machine.id(), %reason, "agent session stopped");
                    stepped = Stepped::Stopped;
                }
            }
        }

        stepped
    }

    /// Log then send: the log entry is written first so the session's history
    /// never lacks a message its agent received.
    #[tracing::instrument(
        name = "agent.acp.deliver",
        err,
        skip(self, from, message),
        fields(
            agent.session.id = %self.machine.id(),
            rpc.system.name = tracing::field::Empty,
            rpc.method = tracing::field::Empty,
        )
    )]
    async fn deliver(
        &mut self,
        from: Option<MacroUserIdStr<'static>>,
        message: ToRuntimeMessage,
    ) -> Result<()> {
        if let Some(method) = acp_method(&message) {
            tracing::Span::current().record("rpc.system.name", "jsonrpc");
            tracing::Span::current().record("rpc.method", method);
        }
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

    fn finish_handshake_if_complete(&mut self) {
        match self.machine.status() {
            RuntimeStatus::Live { .. } => {
                self.handshake_span.take();
            }
            RuntimeStatus::Dead => {
                if let Some(span) = self.handshake_span.take() {
                    span.record("otel.status_code", "ERROR");
                    span.record("otel.status_description", "ACP handshake failed");
                }
            }
            RuntimeStatus::Booting | RuntimeStatus::Handshaking => {}
        }
    }

    /// The failing effect's own caller gets `cause` itself; anything still
    /// queued behind it never reached the runtime, so it gets `Disconnected`.
    fn fail_remaining_completions(
        &self,
        effects: &mut VecDeque<Effect<SessionCompletion>>,
        cause: AgentSessionError,
    ) {
        let mut stop = None;
        let mut cause = Some(cause);
        while let Some(effect) = effects.pop_front() {
            match effect {
                Effect::Complete { token, .. } => {
                    let error = cause
                        .take()
                        .unwrap_or_else(|| AgentSessionError::Disconnected(self.machine.id()));
                    token.span.record("otel.status_code", "ERROR");
                    token
                        .span
                        .record("otel.status_description", tracing::field::display(&error));
                    let _ = token.completed.send(Err(error));
                }
                effect @ Effect::Stop { .. } => stop = Some(effect),
                Effect::Send { .. }
                | Effect::Log { .. }
                | Effect::PersistAcpSession { .. }
                | Effect::Initialized { .. } => {}
            }
        }
        if let Some(stop) = stop {
            effects.push_back(stop);
        }
    }
}

fn acp_method(message: &ToRuntimeMessage) -> Option<&str> {
    let ToRuntimeMessage::Acp(AcpMessage(frame)) = message else {
        return None;
    };
    match frame {
        RawJsonRpcMessage::Request(request) => Some(request.method.as_ref()),
        RawJsonRpcMessage::Notification(notification) => Some(notification.method.as_ref()),
        RawJsonRpcMessage::Response(_) => None,
    }
}
