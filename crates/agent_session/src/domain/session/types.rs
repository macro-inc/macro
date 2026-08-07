//! The machine's vocabulary: phases, inputs, and effects.

use agent_client_protocol::schema::v1::{RequestId, SessionId};
use agent_runtime_protocol::domain::action::AgentAction;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::Result;

/// An action accepted before there was a live ACP session to send it through.
#[derive(Debug)]
pub(super) struct PendingAction<Token> {
    pub(super) from: Option<MacroUserIdStr<'static>>,
    pub(super) action: AgentAction,
    pub(super) token: Token,
}

pub(super) enum SessionPhase {
    /// The runtime has not reported its agent ready. Nothing may go out.
    Booting,
    /// Waiting for the agent to acknowledge `initialize`.
    Initializing {
        /// Request id used to recognize the initialize response.
        request_id: RequestId,
    },
    /// Waiting for the agent to create an ACP session.
    Opening {
        /// Request id used to recognize the `session/new` response.
        request_id: RequestId,
        /// How this connection is establishing its ACP session.
        kind: SessionOpening,
    },
    Live {
        session_id: SessionId,
    },
    Dead,
}

#[derive(Clone)]
pub(super) enum SessionOpening {
    New,
    Resume(SessionId),
    Load(SessionId),
}

/// Observable phase of a session connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeStatus {
    /// Waiting for the runtime to report its agent ready.
    Booting,
    /// The ACP handshake is in flight.
    Handshaking,
    /// Actions flow immediately through this ACP session.
    Live {
        /// Session identifier chosen by the ACP agent.
        session_id: SessionId,
    },
    /// The connection is over; a fresh attach needs a fresh machine.
    Dead,
}

impl RuntimeStatus {
    /// ACP session identifier when the runtime is live.
    #[must_use]
    pub fn session_id(&self) -> Option<&SessionId> {
        match self {
            Self::Live { session_id } => Some(session_id),
            Self::Booting | Self::Handshaking | Self::Dead => None,
        }
    }
}

/// Why a connection is over, as observed by the shell.
///
/// Exhaustive on purpose: every way a connection can end has to name itself,
/// so a dead session's last log line says what actually happened rather than
/// a catch-all. The underlying error details are traced where they occur;
/// this is the *shape* of the death, cheap to match on in tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    /// Every handle was dropped; no caller can reach this session again.
    Abandoned,
    /// The transport reported the end of its stream.
    TransportClosed,
    /// The transport failed outright.
    TransportFailed,
    /// The shell could not put an action on the transport.
    SendFailed,
    /// The shell could not persist a log entry, and an unlogged session may
    /// not keep running: the log stream is the session's history.
    LogFailed,
}

impl std::fmt::Display for CloseReason {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Abandoned => "every handle to the session was dropped",
            Self::TransportClosed => "the transport closed",
            Self::TransportFailed => "the transport failed",
            Self::SendFailed => "an action could not be sent",
            Self::LogFailed => "a log entry could not be persisted",
        })
    }
}

/// One thing that happened to this connection.
#[derive(Debug)]
pub enum Input<Token> {
    /// A caller wants this action delivered.
    Command {
        /// The user whose request this is, when it came from one.
        from: Option<MacroUserIdStr<'static>>,
        /// What to deliver.
        action: AgentAction,
        /// Rides along until the action reaches the transport, then comes
        /// back out in [`Effect::Complete`].
        token: Token,
    },
    /// The transport produced a message.
    Inbound(ToServerMessage),
    /// The connection is over. Idempotent: a dead machine ignores it.
    Closed(CloseReason),
}

#[derive(Debug)]
pub enum Effect<Token> {
    /// Log then send on the transport.
    Send {
        /// The user whose request this is, for the log entry.
        from: Option<MacroUserIdStr<'static>>,
        /// The envelope to deliver.
        message: ToRuntimeMessage,
    },
    /// Persist an inbound message to the session's log stream.
    Log {
        /// The envelope to persist.
        message: ToServerMessage,
    },
    /// Persist the ACP session id before allowing prompts onto the wire.
    PersistAcpSession {
        /// Agent-assigned session identifier.
        session_id: SessionId,
    },
    /// Resolve a caller's delivery future.
    Complete {
        /// The token the caller handed in with [`Input::Command`].
        token: Token,
        /// Whether the action reached the transport.
        result: Result<()>,
    },
    /// Tear the connection down. Always the final effect of its batch; the
    /// machine is [`RuntimeStatus::Dead`] once it appears.
    Stop {
        /// Why, for the shell's diagnostics.
        reason: StopReason,
    },
}

/// Why the machine ended its connection.
///
/// A superset of [`CloseReason`]: the shell reports closes, but the machine
/// also dies of its own causes during the handshake.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    /// The shell reported the connection over.
    Closed(CloseReason),
    /// The handshake could not even be serialized; the detail is the
    /// serializer's.
    HandshakeNotBuildable(String),
    /// The agent refused `initialize`.
    InitializationRefused,
    /// The agent answered `initialize` with an invalid response.
    InitializationUnintelligible(String),
    /// The agent cannot restore a previously opened ACP session.
    ResumeUnsupported,
    /// The agent refused `session/new`.
    SessionRefused,
    /// The agent answered `session/new` with something unintelligible; the
    /// detail is the parser's.
    SessionUnintelligible(String),
}

impl std::fmt::Display for StopReason {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Closed(reason) => reason.fmt(formatter),
            Self::HandshakeNotBuildable(detail) => {
                write!(formatter, "could not build the acp handshake: {detail}")
            }
            Self::InitializationRefused => formatter.write_str("the agent refused initialize"),
            Self::InitializationUnintelligible(detail) => {
                write!(
                    formatter,
                    "the agent returned an invalid initialize response: {detail}"
                )
            }
            Self::ResumeUnsupported => {
                formatter.write_str("the agent supports neither session/resume nor session/load")
            }
            Self::SessionRefused => formatter.write_str("the agent refused session/new"),
            Self::SessionUnintelligible(detail) => {
                write!(
                    formatter,
                    "the agent answered session/new unintelligibly: {detail}"
                )
            }
        }
    }
}
