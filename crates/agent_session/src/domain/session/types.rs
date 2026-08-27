//! The machine's vocabulary: phases, inputs, and effects.

use agent_client_protocol::schema::v1::{RequestId, SessionId};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::Result;

/// An action accepted before there was a live ACP session to send it through.
#[derive(Debug)]
pub(super) struct PendingAction<Token> {
    pub(super) from: Option<MacroUserIdStr<'static>>,
    pub(super) action: AgentAction,
    pub(super) action_id: AgentActionId,
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

/// What the agent said it can do about a session it has seen before, distilled
/// from the `initialize` response.
///
/// Only these two facts decide how a session opens, and one connection's
/// answer serves every session on it - so this is what gets shared, rather
/// than the protocol's whole capability set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionRestoreSupport {
    /// The agent offers `session/resume`.
    pub resume: bool,
    /// The agent offers `session/load`.
    pub load: bool,
}

/// Where the sessions on one connection learn that its ACP handshake is done.
///
/// Exactly one session runs `initialize` per connection; the rest wait for
/// its answer here rather than initializing again. Retained rather than
/// broadcast, because a session can bind long after the handshake finished
/// and still needs to be told - it reads the current value on subscribe.
///
/// The states are a claim as much as a status: exactly one session may run
/// the handshake, so moving `Pending` to `InFlight` is how a session takes
/// that job and how every other session knows not to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandshakeStatus {
    /// Nobody has started initializing this connection.
    Pending,
    /// A session is initializing it; the rest wait rather than initialize too.
    InFlight,
    /// The connection is initialized and sessions may open.
    Ready(SessionRestoreSupport),
}

/// Observable phase of a session connection.
#[derive(Debug, Clone, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
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
    /// The runtime did not finish its ACP handshake before the deadline.
    HandshakeTimedOut,
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
            Self::HandshakeTimedOut => "the ACP handshake timed out",
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
        /// The id the action carries onto the wire, minted at accept.
        action_id: AgentActionId,
        /// Rides along until the action reaches the transport, then comes
        /// back out in [`Effect::Complete`].
        token: Token,
    },
    /// The transport produced a message.
    Inbound(ToServerMessage),
    /// Somebody else on this connection completed the ACP handshake, so this
    /// session may open without initializing anything. Ignored unless the
    /// machine is still booting - the machine that ran the handshake sees its
    /// own result come back this way too.
    Ready {
        /// What that handshake learned about restoring sessions.
        restore: SessionRestoreSupport,
    },
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
    /// This machine ran the connection's `initialize` and learned what the
    /// agent can do. Emitted so the connection can answer for every session
    /// that opens after this one, including those that bind hours later.
    Initialized {
        /// What the handshake learned about restoring sessions.
        restore: SessionRestoreSupport,
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
