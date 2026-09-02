use crate::domain::document_id::DocumentId;
use crate::domain::models::{BlameRow, DocumentMetadata, GetSnapshotRequest, PeerResponse};
use crate::domain::permissions::AuthToken;

/// An error from a [`SyncService`] operation. Maps to HTTP 500 at the inbound
/// edge.
#[derive(Debug, thiserror::Error)]
pub enum SyncServiceError {
    #[error(transparent)]
    Internal(#[from] worker::Error),
}

/// The durable object implements this; the axum handlers depend on it.
#[allow(async_fn_in_trait)]
pub trait SyncServiceCore {
    /// Open a websocket sync connection for an already-authenticated peer.
    /// Returns the `101` upgrade response (the one endpoint whose result is an
    /// irreducible websocket upgrade rather than typed data).
    async fn connect(
        &self,
        claims: AuthToken,
        id: &DocumentId,
    ) -> Result<worker::Response, SyncServiceError>;

    /// Whether the document exists.
    async fn exists(&self, id: &DocumentId) -> Result<bool, SyncServiceError>;

    /// Document metadata, or `None` if the document doesn't exist.
    async fn metadata(&self, id: &DocumentId)
    -> Result<Option<DocumentMetadata>, SyncServiceError>;

    /// The document's raw JSON, or `None` if it doesn't exist.
    async fn raw(&self, id: &DocumentId) -> Result<Option<String>, SyncServiceError>;

    /// The peer ids currently connected. With `include_ai = false`, AI editors
    /// (peer ids from the reserved AI block) are filtered out so callers see
    /// only human collaborators.
    async fn active_peers(&self, include_ai: bool) -> Result<Vec<u64>, SyncServiceError>;

    /// Resolve the user behind a peer id on a document.
    async fn peer(&self, id: &DocumentId, peer_id: &str) -> Result<PeerResponse, SyncServiceError>;

    /// Last-edit info for a Lexical node, or `None` if no blame is recorded.
    async fn blame(
        &self,
        id: &DocumentId,
        node_id: &str,
    ) -> Result<Option<BlameRow>, SyncServiceError>;

    /// A Loro snapshot of the document, or `None` if it doesn't exist.
    async fn snapshot(
        &self,
        id: &DocumentId,
        request: GetSnapshotRequest,
    ) -> Result<Option<Vec<u8>>, SyncServiceError>;

    /// Initialize a not-yet-existing document from a snapshot.
    async fn initialize(&self, id: &DocumentId, snapshot: Vec<u8>) -> Result<(), SyncServiceError>;

    /// Warm the document into memory and keep the worker alive. Returns the
    /// keepalive timeout handle it replaced, if any (serialized as the wakeup
    /// response body).
    async fn wakeup(&self, id: &DocumentId) -> Result<Option<(i32, i32)>, SyncServiceError>;
}

/// Privileged diagnostic endpoints, gated behind Admin access. Segregated from
/// [`SyncServiceCore`] so the product surface stays focused and core tests need
/// not stub these.
#[allow(async_fn_in_trait)]
pub trait SyncServiceAdmin {
    /// Dump the pending operation log, or `None` if the document doesn't exist.
    async fn dump_operations(
        &self,
        id: &DocumentId,
    ) -> Result<Option<Vec<(String, Vec<u8>)>>, SyncServiceError>;

    /// Read a single durable-object KV value.
    async fn debug_kv_get(&self, key: &str) -> Result<serde_json::Value, SyncServiceError>;

    /// List durable-object KV entries under a prefix.
    async fn debug_kv_list(&self, prefix: &str)
    -> Result<Vec<(String, Vec<u8>)>, SyncServiceError>;
}
