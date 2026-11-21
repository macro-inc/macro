//! Draft `agent-runtime.v0` message types.
//!
//! The logical protocol multiplexes two kinds of traffic over one stream:
//! runtime/agent lifecycle events and ACP conversation traffic. Each
//! direction has its own envelope - [`ToRuntimeMessage`] for Agent Service to
//! Agent Runtime traffic and [`ToServerMessage`] for the reverse -
//! discriminated by a `"type"` field. Only the wrapped ACP payload is itself
//! a JSON-RPC message; the outer envelope is not.
//!
//! A connection hosts exactly one agent execution, so nothing on this schema
//! needs an agent or agent-instance identifier: [`AcpMessage`] simply carries
//! the agent's raw ACP traffic.

use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::SessionConfigOption;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use specta::Type;
use specta_typescript::Unknown;

#[cfg(test)]
mod test;

/// The kind of runtime or agent state transition reported to the Agent Service.
///
/// The protocol does not define a full event-name catalog yet, so this enum
/// is non-exhaustive: unrecognized wire strings still round-trip losslessly
/// through [`SystemEvent::Unknown`]. [`SystemEvent::AcpReady`] is the one
/// name the Agent Service actually acts on - it waits for it before starting
/// the ACP `initialize`/`session/new` handshake - rather than merely
/// forwarding it for observability.
///
/// This has a hand-written [`Serialize`]/[`Deserialize`] impl rather than a
/// derive, so it cannot derive [`specta::Type`] either: nothing here
/// introspects its shape for TypeScript. Every field that carries a
/// `SystemEvent` is instead given a `#[specta(type = String)]` override at
/// the field, matching the plain string it actually serializes as.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SystemEvent {
    /// The Agent Runtime's hosted agent process is up and its ACP channel is
    /// wired end-to-end: the Agent Service may now start the ACP
    /// `initialize`/`session/new` handshake. Sent at most once per
    /// connection, before any ACP traffic.
    AcpReady,
    /// The session transport closed or failed and no more frames will arrive.
    Disconnected,
    /// The hosted provider recovered history; the client must reload when idle.
    ReloadRequired,
    /// An application-defined event name with no protocol-level meaning yet.
    Unknown(String),
}

impl SystemEvent {
    /// Borrow the wire string for this event name.
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::AcpReady => "acp_ready",
            Self::Disconnected => "disconnected",
            Self::ReloadRequired => "reload_required",
            Self::Unknown(name) => name,
        }
    }
}

impl Serialize for SystemEvent {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for SystemEvent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match String::deserialize(deserializer)?.as_str() {
            "acp_ready" => Self::AcpReady,
            "disconnected" => Self::Disconnected,
            "reload_required" => Self::ReloadRequired,
            name => Self::Unknown(name.to_owned()),
        })
    }
}

/// One complete ACP JSON-RPC message routed between the Agent Service and the
/// single agent execution hosted by this connection.
///
/// Its own JSON-RPC fields are opaque to TypeScript consumers here (typed as
/// an arbitrary object of unknown values): they already have a proper ACP SDK
/// on the TypeScript side, so this crate only needs to guarantee the message
/// round-trips unchanged. This is typed as a map rather than plain `unknown`
/// because [`ToRuntimeMessage`]/[`ToServerMessage`] carry it in an internally
/// tagged `Acp` variant, which requires its payload provably serialize as an
/// object so the `"type"` tag can be merged into it. `#[serde(transparent)]`
/// changes nothing about the actual wire format here - a single-field tuple
/// struct already serializes transparently by default - but it does tell
/// specta's serde-compatibility checker that this newtype is transparent, so
/// it looks through to the map type below instead of treating `AcpMessage`
/// itself as an opaque, non-mergeable struct.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct AcpMessage(
    #[specta(type = std::collections::HashMap<String, Unknown>)] pub RawJsonRpcMessage,
);

/// The result of probing a fresh ACP subprocess.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ModelProbeResult {
    /// The raw options returned by `session/new`.
    Available {
        /// Session configuration options exactly as the agent returned them.
        #[serde(rename = "configOptions")]
        #[specta(type = Vec<Unknown>)]
        config_options: Vec<SessionConfigOption>,
    },
    /// A safe, operator-actionable failure description.
    Error {
        /// Failure text safe to return across the runtime connection.
        message: String,
    },
}

/// The dial header a runtime lists the optional messages it accepts in,
/// comma-separated. The service sends an optional message only to a runtime
/// that listed it, so older runtimes never receive one they cannot read.
pub const RUNTIME_ACCEPTS_HEADER: &str = "x-macro-runtime-accepts";

/// The [`RUNTIME_ACCEPTS_HEADER`] entry for [`ToRuntimeMessage::AgentsChanged`].
pub const ACCEPTS_AGENTS_CHANGED: &str = "agents-changed";

/// The [`RUNTIME_ACCEPTS_HEADER`] entry for [`ToRuntimeMessage::ApplyAgent`]:
/// a runtime that doesn't list it can't run an agent teammate.
pub const ACCEPTS_APPLY_AGENT: &str = "apply-agent";

/// Agent Service to Agent Runtime traffic on the logical protocol stream.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
#[non_exhaustive]
pub enum ToRuntimeMessage {
    /// An ACP message routed to the hosted agent.
    Acp(AcpMessage),
    /// Probe a separate fresh agent process for its session configuration.
    ///
    /// The request carries no parameters: it asks this connection's one
    /// configured harness what it advertises. Answers are therefore
    /// interchangeable, so nothing correlates a response to a request.
    ModelProbeRequest,
    /// The agents bound to this runtime may have changed: re-read them.
    ///
    /// A hint with no payload, sent when the service may have just bound an
    /// agent to the runtime, so it starts serving that agent's triggers at
    /// once rather than at its next poll. Runtimes that do not serve
    /// triggers ignore it.
    AgentsChanged,
    /// Run this agent teammate on the computer: write its environment where
    /// the guest's agent service reads it, which (re)starts the agent. Sent
    /// to a warm pool computer a purchase took for an agent; the agent's own
    /// online report, not a reply, confirms it.
    ApplyAgent {
        /// The agent's environment.
        environment: AgentEnvironment,
        /// W3C context of the computer's setup, so the agent's start joins
        /// its trace. Absent from older services.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        traceparent: Option<String>,
    },
}

/// An agent teammate's environment: credentials and addresses, one variable
/// each. Debug shows only the names.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct AgentEnvironment(
    #[specta(type = std::collections::HashMap<String, String>)]
    pub  std::collections::BTreeMap<String, String>,
);

/// The values are credentials: wiped from memory when dropped.
impl Drop for AgentEnvironment {
    fn drop(&mut self) {
        for value in self.0.values_mut() {
            zeroize::Zeroize::zeroize(value);
        }
    }
}

impl std::fmt::Debug for AgentEnvironment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentEnvironment")
            .field("names", &self.0.keys().collect::<Vec<_>>())
            .finish()
    }
}

/// Agent Runtime to Agent Service traffic on the logical protocol stream.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
#[non_exhaustive]
pub enum ToServerMessage {
    /// An ACP message routed from the hosted agent.
    Acp(AcpMessage),
    /// A runtime or agent lifecycle event.
    Event {
        /// The event name.
        #[specta(type = String)]
        event: SystemEvent,
    },
    /// An answer to a connection-level model probe.
    ModelProbeResponse {
        /// Raw options or a safe failure.
        result: ModelProbeResult,
    },
}
