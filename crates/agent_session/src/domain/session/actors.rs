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
use agent_client_protocol::schema::v1::SessionId;
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
/// How long one ACP turn may remain active before attribution becomes unsafe.
const TURN_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// A caller's request to deliver one action, and the wire back to them.
pub(crate) struct SessionCommand {
    pub(crate) user_id: Option<MacroUserIdStr<'static>>,
    pub(crate) action: AgentAction,
    pub(crate) action_id: AgentActionId,
    pub(crate) completed: oneshot::Sender<Result<()>>,
    pub(crate) span: tracing::Span,
}

pub(crate) struct SessionCompletion {
    completed: oneshot::Sender<Result<()>>,
    span: tracing::Span,
}

struct ActiveTurn {
    request_id: agent_client_protocol::schema::v1::RequestId,
    span: tracing::Span,
    deadline: Instant,
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
    active_turn: Option<ActiveTurn>,
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
                None => SessionMachine::new(id, workspace),
                Some(session_id) => SessionMachine::resume(id, session_id, workspace),
            },
            logs,
            commands,
            handshake_span: Some(handshake_span),
            handshake_deadline: Instant::now() + HANDSHAKE_TIMEOUT,
            active_turn: None,
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
            let turn_deadline = self.active_turn.as_ref().map(|turn| turn.deadline);
            let turn_timeout = async move {
                match turn_deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending::<()>().await,
                }
            };
            let input = tokio::select! {
            () = handshake_timeout => Input::Closed(CloseReason::HandshakeTimedOut),
            () = turn_timeout => {
                Input::Closed(CloseReason::TurnTimedOut)
            },
            command = self.commands.recv() => match command {
                Some(SessionCommand { user_id, action, action_id, completed, span }) => Input::Command {
                    from: user_id,
                    action,
                    action_id,
                    token: SessionCompletion { completed, span },
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
        let mut inbound_span = self.inbound_turn_span(&input);
        let handshake_deadline = self.handshake_deadline;
        let mut handshake_span = self.handshake_span.clone();
        let produced = match (&inbound_span, &handshake_span) {
            (Some(span), _) => span.in_scope(|| self.machine.handle(input)),
            (None, Some(span)) => span.in_scope(|| self.machine.handle(input)),
            (None, None) => self.machine.handle(input),
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
                    if let (Some(span), Some(request_id)) =
                        (command_span.as_ref(), turn_request_id(&message))
                    {
                        debug_assert!(self.active_turn.is_none());
                        self.active_turn = Some(ActiveTurn {
                            request_id,
                            span: tracing::info_span!(
                                parent: span,
                                "agent.turn",
                                agent.session.id = %self.machine.id(),
                                otel.status_code = tracing::field::Empty,
                                otel.status_description = tracing::field::Empty,
                            ),
                            deadline: Instant::now() + TURN_TIMEOUT,
                        });
                    }
                    let turn_span = self.active_turn.as_ref().map(|turn| turn.span.clone());
                    let delivery = self.deliver(from, message);
                    let (result, close_reason) = match (
                        turn_span.as_ref(),
                        command_span.as_ref(),
                        handshake_span.as_ref(),
                    ) {
                        (Some(span), _, _) | (None, Some(span), _) => match tokio::time::timeout(
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
                        (None, None, Some(span)) => match tokio::time::timeout_at(
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
                        (None, None, None) => {
                            match tokio::time::timeout(COMMAND_DELIVERY_TIMEOUT, delivery).await {
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
                    let (result, close_reason) =
                        match (inbound_span.as_ref(), handshake_span.as_ref()) {
                            (Some(span), _) => match tokio::time::timeout(
                                COMMAND_DELIVERY_TIMEOUT,
                                log.instrument(span.clone()),
                            )
                            .await
                            {
                                Ok(result) => (result, CloseReason::LogFailed),
                                Err(_) => (
                                    Err(AgentSessionError::LogTimedOut(self.machine.id())),
                                    CloseReason::LogFailed,
                                ),
                            },
                            (None, Some(span)) => match tokio::time::timeout_at(
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
                            (None, None) => {
                                match tokio::time::timeout(COMMAND_DELIVERY_TIMEOUT, log).await {
                                    Ok(result) => (result, CloseReason::LogFailed),
                                    Err(_) => (
                                        Err(AgentSessionError::LogTimedOut(self.machine.id())),
                                        CloseReason::LogFailed,
                                    ),
                                }
                            }
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
                Effect::TurnFinished { request_id, error } => {
                    // The response child must close before its long-lived turn
                    // parent, otherwise exporters can observe an inverted tree.
                    inbound_span.take();
                    let Some(turn) = self.active_turn.take() else {
                        tracing::error!(%request_id, "completed an ACP turn with no active span");
                        continue;
                    };
                    debug_assert_eq!(turn.request_id, request_id);
                    if let Some(error) = error {
                        turn.span.record("otel.status_code", "ERROR");
                        turn.span.record("otel.status_description", &error);
                    }
                }
                Effect::Stop { reason } => {
                    inbound_span.take();
                    let turn_span = self.active_turn.as_ref().map(|turn| turn.span.clone());
                    let terminal_log = self.log(
                        None,
                        Message::ToServer(ToServerMessage::Event {
                            event: SystemEvent::Disconnected,
                        }),
                    );
                    let result = match turn_span {
                        Some(span) => {
                            tokio::time::timeout(
                                COMMAND_DELIVERY_TIMEOUT,
                                terminal_log.instrument(span),
                            )
                            .await
                        }
                        None => tokio::time::timeout(COMMAND_DELIVERY_TIMEOUT, terminal_log).await,
                    };
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
                    self.fail_active_turn(&reason.to_string());
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
                | Effect::Initialized { .. }
                | Effect::TurnFinished { .. } => {}
            }
        }
        if let Some(stop) = stop {
            effects.push_back(stop);
        }
    }

    fn inbound_turn_span(&self, input: &Input<SessionCompletion>) -> Option<tracing::Span> {
        let Input::Inbound(ToServerMessage::Acp(AcpMessage(frame))) = input else {
            return None;
        };
        let turn = self.active_turn.as_ref()?;
        match frame {
            RawJsonRpcMessage::Response(response)
                if frame.response_id() == Some(&turn.request_id) =>
            {
                let span = tracing::info_span!(parent: &turn.span, "agent.turn.response");
                if let agent_client_protocol::schema::v1::Response::Error { error, .. } = response {
                    span.record("otel.status_code", "ERROR");
                    span.record(
                        "otel.status_description",
                        tracing::field::display(&error.message),
                    );
                }
                Some(span)
            }
            RawJsonRpcMessage::Notification(notification)
                if notification.method.as_ref() == "session/update" =>
            {
                Some(tracing::info_span!(parent: &turn.span, "agent.turn.update"))
            }
            _ => None,
        }
    }

    fn fail_active_turn(&mut self, description: &str) {
        if let Some(turn) = self.active_turn.take() {
            turn.span.record("otel.status_code", "ERROR");
            turn.span.record("otel.status_description", description);
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

fn turn_request_id(
    message: &ToRuntimeMessage,
) -> Option<agent_client_protocol::schema::v1::RequestId> {
    let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = message else {
        return None;
    };
    (request.method.as_ref() == "session/prompt").then(|| request.id.clone())
}
