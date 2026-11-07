//! Room failures; CS-56: runtime errors remain local to the single-threaded callback.
use super::super::{
    socket::{SocketTagError, WebSocketId},
    state_error::StateError,
};
use rootcause::{
    Report,
    markers::{Dynamic, Local, Mutable},
};

/// Runtime capability that failed.
#[derive(Debug, Clone, Copy)]
pub enum PortName {
    /// Deferred inbound body parsing or reading.
    RequestBody,
    /// Transactional room storage.
    Storage,
    /// Session snapshot transport.
    Snapshots,
    /// Socket transport.
    Connections,
    /// Durable alarms.
    Alarm,
    /// Peer attribution directory.
    Peers,
}
/// Local error report retaining the original runtime error.
pub type LocalReport = Report<Dynamic, Mutable, Local>;
/// Failures corresponding exclusively to the previous callback's Err paths.
#[derive(Debug, thiserror::Error)]
pub enum RoomError {
    /// Test-only adapter-selected migration persistence failure.
    #[error("injected migration persistence failure")]
    InjectedMigrationPersistence,
    /// Frozen imports must resolve every pending dependency.
    #[error("migration has unresolved pending operations")]
    MigrationPending,
    /// Frozen content must cover the durable saved revision.
    #[error("migration snapshot is behind saved revision")]
    MigrationBehindSaved,
    /// Legacy migration decoding context.
    #[error("{context} : {error}")]
    MigrationContext {
        /// Operation context.
        context: &'static str,
        /// Original debug representation.
        error: String,
    },
    /// Test-only adapter-selected stop after surface persistence.
    #[error("injected surface persistence failure")]
    InjectedSurfacePersistence,
    /// The room has no persisted identity.
    #[error("DOCUMENT_ID not found in storage")]
    NoSession,
    /// A socket tag has no persisted metadata.
    #[error("WebSocketMetadata not found in storage")]
    MissingConnectionMetadata(WebSocketId),
    /// Invalid hibernation tags.
    #[error(transparent)]
    SocketTag(#[from] SocketTagError),
    /// Loro rejected document content.
    #[error(transparent)]
    Loro(#[from] StateError),
    /// The inbound frame was malformed.
    #[error(transparent)]
    Framing(#[from] sync_protocol::framing::FramingError),
    /// The Bebop payload could not be decoded.
    #[error("failed to deserialize message, message length {length} : {error:?}")]
    Decode {
        /// Input payload length.
        length: usize,
        /// Codec error.
        error: bebop::DeserializeError,
    },
    /// Initial snapshot request decoding failed.
    #[error(
        "Failed to deserialize InitializeFromSnapshotRequest with document_id: [{key}] : {error:?}"
    )]
    InitializeDecode {
        /// Requested storage key.
        key: String,
        /// Codec error.
        error: bebop::DeserializeError,
    },
    /// The peer has no recorded user mapping.
    #[error("no user found for peer id")]
    MissingPeer,
    /// The message discriminator is unknown.
    #[error("unknown message type")]
    UnknownMessage,
    /// A version vector was malformed.
    #[error("failed to decode version vector : {0:?}")]
    VersionVector(loro::LoroError),
    /// Document policy rejected an update or attribution.
    #[error(transparent)]
    Document(#[from] crate::domain::document::DocumentError),
    /// An outbound runtime capability failed.
    #[error("{report}")]
    Port {
        /// Capability that failed.
        port: PortName,
        /// Original, possibly non-Send runtime failure.
        report: LocalReport,
    },
}
impl RoomError {
    /// Preserve a runtime connection failure at an inbound adapter boundary.
    pub fn runtime_connections<E: std::error::Error + 'static>(error: E) -> Self {
        Self::port(PortName::Connections, error)
    }

    pub(super) fn port<E: std::error::Error + 'static>(port: PortName, error: E) -> Self {
        Self::Port {
            port,
            report: Report::new(error).into_dynamic(),
        }
    }
}
