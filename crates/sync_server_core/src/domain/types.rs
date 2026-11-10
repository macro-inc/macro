//! Opaque legacy session identities and data exchanged with room ports.
use macro_sync_service_jwt::session::SessionKind;
use serde::Serialize;

/// A persisted session key, kept verbatim for compatibility.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SessionKey(String);

impl SessionKey {
    /// Retain an adapter-supplied legacy key without changing its spelling.
    pub fn new(value: String) -> Self {
        Self(value)
    }
    /// The exact persisted key.
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Resolve the existing surface-prefix discriminant.
    pub fn kind(&self) -> SessionKind {
        if self.0.starts_with("surface:") {
            SessionKind::Surface
        } else {
            SessionKind::Document
        }
    }
    /// Restrict this key to a document before requesting document effects.
    pub fn document(&self) -> Option<DocumentKey> {
        (self.kind() == SessionKind::Document).then(|| DocumentKey(self.clone()))
    }
}

/// A session key verified to refer to a document.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DocumentKey(SessionKey);
impl DocumentKey {
    /// The document's exact persisted key.
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// An operation-log ID without its adapter-owned storage namespace.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct OperationId(String);
impl OperationId {
    /// Retain a stored or newly generated operation ID verbatim.
    pub fn new(value: String) -> Self {
        Self(value)
    }
    /// The exact ID suffix used by the storage adapter.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A Loro peer identifier.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PeerId(pub u64);

/// One pending operation read from durable storage.
#[derive(Clone, Debug)]
pub struct PendingOperation {
    /// Stored operation identifier.
    pub id: OperationId,
    /// Unmodified Loro update bytes.
    pub update: Vec<u8>,
    /// Archive completion loaded in the same pending-prefix read.
    pub archive: OperationArchive,
}

/// A buffered last-editor observation awaiting the background writer.
#[derive(Clone, Debug)]
pub struct BlameEvent {
    /// Document containing the edited node.
    pub document_id: String,
    /// Lexical node identifier.
    pub node_id: String,
    /// Loro peer that edited the node.
    pub peer_id: u64,
    /// Wall-clock edit time in Unix milliseconds.
    pub timestamp_ms: i64,
}

/// Why a document interaction was reported to its owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionReason {
    /// A periodic save of pending content changes.
    Edited,
    /// The first peer joined the document session.
    FirstJoin,
    /// The last connected peer left the document session.
    LastLeave,
}

impl std::ops::Deref for SessionKey {
    type Target = str;
    fn deref(&self) -> &str {
        self.as_str()
    }
}
impl std::fmt::Display for SessionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.as_str().fmt(f)
    }
}

impl std::borrow::Borrow<u64> for PeerId {
    fn borrow(&self) -> &u64 {
        &self.0
    }
}

/// Attribution used for document writes without a user identity.
pub const SYSTEM_AUTHOR_ID: &str = "system";

/// Persisted completion of the archive and signed attribution for a pending row.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum OperationArchive {
    /// A deployed row predating completion receipts; repair conservatively once.
    #[default]
    Legacy,
    /// Pending bytes are durable, but archive or attribution may still be absent.
    Incomplete {
        /// Original verified attribution; never replace it with retrying claims.
        attribution: Option<super::document::DocumentAttribution>,
    },
    /// Archive and attribution completed; retain this receipt until pending GC.
    Complete,
}

/// Reserved pending-prefix sidecars, excluded from Loro operation replay.
pub const OPERATION_ARCHIVE_PREFIX: &str = "o/!archive-status-v1/";

/// Durable archive-status key for one logical pending row.
pub fn operation_archive_key(id: &OperationId) -> String {
    format!("{OPERATION_ARCHIVE_PREFIX}{}", id.as_str())
}

/// One authoritative pending-prefix read, including notification metadata.
pub struct PendingOperations<E> {
    /// Legacy and modern logical updates, preserving per-entry legacy errors.
    pub entries: Vec<Result<PendingOperation, E>>,
    /// Durable fanout debt; never imported or garbage-collected as an operation.
    pub fanout: Option<super::fanout::FanoutDebt>,
}

impl<E> std::ops::Deref for PendingOperations<E> {
    type Target = [Result<PendingOperation, E>];
    fn deref(&self) -> &Self::Target {
        &self.entries
    }
}
