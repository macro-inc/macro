//! Port traits for capabilities the agent proxy domain requires.
//!
//! Chat persistence reuses the `chat` crate's domain ports directly
//! ([`chat::domain::ports::ChatRepo`] and [`chat::domain::ports::MessageRepo`]);
//! only the capabilities unique to this service are defined here.

use crate::domain::models::Result;
use agent_client_protocol::RawJsonRpcMessage;
use macro_uuid::Uuid;
use std::future::Future;

/// Live connections to agent runtimes, keyed by session (agent entity) ID.
///
/// Implementations route a raw ACP JSON-RPC message to the runtime currently
/// hosting the session. Registration of sessions is an adapter concern; the
/// domain only needs delivery.
pub trait RuntimeSessions: Send + Sync + 'static {
    /// Forward one raw ACP JSON-RPC message to the runtime hosting the
    /// session. Fails with [`crate::domain::models::AgentProxyErr::SessionNotConnected`]
    /// when the session has no live runtime connection.
    fn send(&self, session_id: Uuid, message: RawJsonRpcMessage) -> Result<()>;

    /// Whether the session currently has a live runtime connection.
    fn is_connected(&self, session_id: Uuid) -> bool;
}

impl<T: RuntimeSessions> RuntimeSessions for std::sync::Arc<T> {
    fn send(&self, session_id: Uuid, message: RawJsonRpcMessage) -> Result<()> {
        T::send(self, session_id, message)
    }

    fn is_connected(&self, session_id: Uuid) -> bool {
        T::is_connected(self, session_id)
    }
}

/// The sending half of an ACP channel to an agent runtime, as returned by
/// `agent_runtime_protocol`'s `ServerConnection::acp`.
pub type AcpSender = futures::channel::mpsc::UnboundedSender<
    std::result::Result<RawJsonRpcMessage, agent_client_protocol::Error>,
>;

/// Identifies one registration of a session. Unregistering requires the
/// matching ID so a stale connection cannot tear down a newer registration
/// for the same session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RegistrationId(pub(crate) u64);

/// Attaching and detaching live runtime sessions (used by the runtime
/// listener; the counterpart of [`RuntimeSessions`], which forwards to them).
pub trait SessionAttachments: Send + Sync + 'static {
    /// Register (or replace) the live ACP sender for a session. `epoch` is a
    /// monotonically increasing connection identifier: registrations from an
    /// older epoch than the current holder's are rejected with `None`, so a
    /// half-dead connection's late attach cannot displace a newer one.
    fn register(&self, session_id: Uuid, epoch: u64, tx: AcpSender) -> Option<RegistrationId>;

    /// Remove a session registration, but only when `registration` still
    /// identifies the current registration for the session. Returns whether
    /// the registration was actually removed, so callers can skip
    /// owner-scoped cleanup when a newer registration displaced theirs.
    fn unregister(&self, session_id: Uuid, registration: RegistrationId) -> bool;
}

impl<T: SessionAttachments> SessionAttachments for std::sync::Arc<T> {
    fn register(&self, session_id: Uuid, epoch: u64, tx: AcpSender) -> Option<RegistrationId> {
        T::register(self, session_id, epoch, tx)
    }

    fn unregister(&self, session_id: Uuid, registration: RegistrationId) -> bool {
        T::unregister(self, session_id, registration)
    }
}

/// Pushes agent session events to connected clients (the connection gateway).
pub trait ClientNotifier: Send + Sync + 'static {
    /// Send a payload to every client tracking the session's chat entity.
    fn notify_session(
        &self,
        session_id: Uuid,
        message_type: &'static str,
        payload: serde_json::Value,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// One queued ACP message, in drain order.
#[derive(Debug, Clone)]
pub struct PendingMessage {
    /// The queue row's id, needed to delete it after delivery.
    pub id: Uuid,
    /// The raw ACP JSON-RPC message exactly as the caller posted it.
    pub message: RawJsonRpcMessage,
}

/// Durably queues ACP messages posted to a session whose runtime is not
/// ready to receive them yet (no runtime connected, or the ACP bootstrap
/// hasn't completed).
///
/// The queue is drained oldest-first by
/// [`crate::domain::service::AgentProxyService::handle_agent_connected`]
/// once the session's ACP bootstrap completes, each row deleted as it is
/// delivered. Rows are only ever deleted on successful delivery, so a
/// message posted before any runtime exists survives disconnects and
/// restarts until some runtime finally receives it.
pub trait PendingMessages: Send + Sync + 'static {
    /// Append one raw ACP message to the session's queue.
    fn enqueue(
        &self,
        session_id: Uuid,
        message: RawJsonRpcMessage,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Every queued message for the session, oldest first.
    fn list(
        &self,
        session_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<Vec<PendingMessage>>> + Send;

    /// Remove a queued message after successful delivery.
    fn delete(&self, id: Uuid) -> impl Future<Output = anyhow::Result<()>> + Send;
}

impl<T: PendingMessages> PendingMessages for std::sync::Arc<T> {
    fn enqueue(
        &self,
        session_id: Uuid,
        message: RawJsonRpcMessage,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        T::enqueue(self, session_id, message)
    }

    fn list(
        &self,
        session_id: Uuid,
    ) -> impl Future<Output = anyhow::Result<Vec<PendingMessage>>> + Send {
        T::list(self, session_id)
    }

    fn delete(&self, id: Uuid) -> impl Future<Output = anyhow::Result<()>> + Send {
        T::delete(self, id)
    }
}
