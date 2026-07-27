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
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use specta::Type;
use specta_typescript::Unknown;

#[cfg(test)]
mod test;

/// The kind of runtime or agent state transition reported to the Agent Service.
///
/// The protocol does not define an event-name catalog yet. This enum is
/// non-exhaustive and currently contains only [`SystemEvent::Unknown`]. Every
/// wire string round-trips through it unchanged.
///
/// This has a hand-written [`Serialize`]/[`Deserialize`] impl rather than a
/// derive, so it cannot derive [`specta::Type`] either: nothing here
/// introspects its shape for TypeScript. Every field that carries a
/// `SystemEvent` is instead given a `#[specta(type = String)]` override at
/// the field, matching the plain string it actually serializes as.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum SystemEvent {
    /// An application-defined event name.
    Unknown(String),
}

impl SystemEvent {
    /// Borrow the wire string for this event name.
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
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
        Ok(Self::Unknown(String::deserialize(deserializer)?))
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

/// Agent Service to Agent Runtime traffic on the logical protocol stream.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
#[non_exhaustive]
pub enum ToRuntimeMessage {
    /// An ACP message routed to the hosted agent.
    Acp(AcpMessage),
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
}
