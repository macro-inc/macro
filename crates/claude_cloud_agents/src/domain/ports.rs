//! Capabilities needed by the Claude session adapter.
use super::model::{Event, Result, SessionId};
use futures::Stream;
use std::{future::Future, pin::Pin};

/// A bounded provider event stream.
pub type Events = Pin<Box<dyn Stream<Item = Result<Event>> + Send>>;

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
