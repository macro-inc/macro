//! Capabilities needed by the Claude session adapter.
use super::model::{Event, Result, SessionId};
use futures::Stream;
use std::{future::Future, pin::Pin};

/// A bounded provider event stream.
pub type Events = Pin<Box<dyn Stream<Item = Result<Event>> + Send>>;

/// Resolve a provider client for exactly one Macro account.
pub trait CloudProvider: Send + Sync + 'static {
    /// Owner-bound conversation and lifecycle operations.
    type Client: Cloud + CloudLifecycle;
    /// A missing connection must never fall back to another account.
    fn connect(&self, owner: &str) -> impl Future<Output = Result<Self::Client>> + Send;
}

/// Lifecycle operations kept separate from an attached conversation.
pub trait CloudLifecycle: Cloud {
    /// Create a conversation with this agent's instructions.
    fn create(&self, instructions: &str) -> impl Future<Output = Result<SessionId>> + Send;
    /// Archive the owner's conversation reversibly.
    fn archive(&self, session: &SessionId) -> impl Future<Output = Result<()>> + Send;
}

/// The host's tool permission policy, exposed by the ACP client in Macro.
pub trait ToolPermissions: Send + Sync {
    /// Ask the host whether this specific tool invocation may proceed.
    fn allow(
        &self,
        tool_id: &str,
        name: &str,
        input: &serde_json::Value,
    ) -> impl Future<Output = Result<bool>> + Send;
}

/// Standalone callers without a permission client refuse approval requests.
pub struct DenyToolPermissions;
impl ToolPermissions for DenyToolPermissions {
    async fn allow(&self, _: &str, _: &str, _: &serde_json::Value) -> Result<bool> {
        Ok(false)
    }
}

/// Account-scoped provider operations. Implementors must never choose another user's credential.
pub trait Cloud: Clone + Send + Sync + 'static {
    /// At most five recent sessions visible through this account's credential.
    fn recent_sessions(&self) -> impl Future<Output = Result<Vec<SessionId>>> + Send;
    /// Submit one event. Mutations are not automatically retried.
    fn send(
        &self,
        session: &SessionId,
        payload: serde_json::Value,
    ) -> impl Future<Output = Result<()>> + Send;
    /// Submit ordered events in a single request. Never retry an uncertain batch.
    fn send_batch(
        &self,
        session: &SessionId,
        payloads: Vec<serde_json::Value>,
    ) -> impl Future<Output = Result<()>> + Send;
    /// Resume durable events after `cursor`, with live ephemeral deltas.
    fn stream(
        &self,
        session: &SessionId,
        cursor: Option<u64>,
    ) -> impl Future<Output = Result<Events>> + Send;
    /// Recover durable transcript from the start for an ACP session/load.
    fn history(&self, session: &SessionId) -> impl Future<Output = Result<Vec<Event>>> + Send;
}
