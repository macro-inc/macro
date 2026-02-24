//! Core traits and types for the stream service.
use super::types::*;
use super::{StreamId, StreamItem};
use async_trait::async_trait;
use futures::stream::Stream;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::Receiver;

/// Default stream should not last longer than 5 minutes
pub const DEFAULT_STREAM_TIMEOUT: Duration = Duration::from_secs(300);

/// A boxed stream that yields items with their offsets.
pub type ItemStream = Pin<Box<dyn Stream<Item = StreamItem> + Send>>;
/// A boxed stream of payloads to append.
pub type PayloadStream = Pin<Box<dyn Stream<Item = serde_json::Value> + Send>>;
pub type ItemId = String;

/// A stream service provides durable stream storage
/// This is the base trait of this crate and should be
/// used by consumers through the StreamManager
#[async_trait]
pub trait StreamRepo: Send + Sync + 'static {
    /// Append an item to an existing stream or create a new stream and append an item to it
    async fn append(&self, id: &StreamId, payload: serde_json::Value) -> Result<ItemId>;
    /// Get an async stream that will stream from the beginning of a stream and continue to
    /// listen for new items
    async fn stream_from_beginning(&self, id: &StreamId) -> Result<ItemStream>;
    /// Mark a stream as closed
    async fn close(&self, id: &StreamId) -> Result<()>;
    /// List active streams for an entity (implementations may treat all streams as active).
    async fn active_streams(&self, entity_id: &str) -> Result<Vec<StreamId>>;
    /// A receiver that receives stream lifecycle events.
    async fn notify(&self) -> Receiver<StreamEvent>;
}

/// Subscribe to all streams on an entity, returning a merged item stream.
#[async_trait]
pub trait StreamManager: Send + Sync + 'static {
    /// Subscribe to all current and future streams for an entity.
    /// Returns a merged stream of items from all streams.
    /// `sender_id` uniquely identifies the subscriber (e.g. a connection, not a user).
    async fn subscribe(&self, sender_id: String, entity_id: String) -> Result<ItemStream>;
    /// Cancel the subscription for the given sender, stopping its stream.
    async fn unsubscribe(&self, sender_id: String) -> Result<()>;
    /// access to the lower-level repo api
    fn repo(&self) -> Arc<dyn StreamRepo>;
}
