//! Owned room memory and the runtime capabilities used by its callbacks.
use super::{
    connection::{ConnectionMetadata, SurfaceLifecycle},
    document::DocumentAttribution,
    migration::SourceState,
    operation_log::OperationLog,
    ports::RoomPorts,
    socket::WebSocketId,
    state::DocumentState,
    types::{BlameEvent, PeerId, SessionKey},
};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    time::Duration,
};
use sync_protocol::presence::EphemeralStore;
use sync_protocol::{framing::Reassembler, time::WallDuration};

/// Runtime-independent room configuration.
pub struct RoomConfig {
    /// Expiration duration for the clock-injected presence store.
    pub awareness_timeout: WallDuration,
    /// Delay used to debounce persistence alarms.
    pub alarm_delay: Duration,
    /// Extension requested while persistence runs.
    pub isolate_keepalive: Duration,
    /// Whether missing document snapshots may be initialized empty.
    pub create_default_state: bool,
    /// Size above which inbound messages produce a warning.
    pub oversized_message_warning: usize,
}

/// One session's owned memory and capabilities. The adapter serializes callbacks.
pub struct Room<Ports: RoomPorts> {
    ports: Ports,
    config: RoomConfig,
    memory: RoomMemory,
}

/// Owned policy state; no runtime handles or synchronization live here.
struct RoomMemory {
    /// Cached durable identity.
    session_key: Option<SessionKey>,
    /// Live imported document and its monotonic save timestamps.
    document: Option<DocumentState>,
    /// Ordered operation IDs and the applied set, retained across same-key reads.
    operation_log: Option<OperationLog>,
    /// Clock-injected presence values and tombstones.
    awareness: EphemeralStore,
    /// Restored metadata indexed by the unchanged socket tag.
    connections: BTreeMap<WebSocketId, ConnectionMetadata>,
    /// Partial frames indexed by the unchanged socket tag.
    inbound: HashMap<WebSocketId, Reassembler>,
    /// Deferred blame observations.
    pending_blame: Vec<BlameEvent>,
    /// Distinct editors since the last publication.
    pending_editors: BTreeSet<DocumentAttribution>,
    /// Writing peers mapped during this activation.
    mapped_writing_peers: BTreeSet<PeerId>,
    /// Cached surface lifecycle.
    surface_lifecycle: Option<SurfaceLifecycle>,
    /// Cached source migration state.
    source_migration: Option<SourceState>,
}

/// Read-only diagnostic values from the current room activation.
pub struct RoomMemoryView<'a> {
    /// Cached durable identity.
    pub session_key: Option<&'a SessionKey>,
    /// Read-only document exports.
    pub document: Option<DocumentView<'a>>,
    /// Peers already mapped during this activation.
    pub mapped_writing_peers: &'a BTreeSet<PeerId>,
}
/// Document inspection without exposing Loro's interior-mutable document handle.
pub struct DocumentView<'a>(&'a DocumentState);
impl DocumentView<'_> {
    /// Export content for replay comparison without changing room policy state.
    pub fn export_snapshot(
        &self,
        mode: Option<loro::ExportMode<'_>>,
    ) -> Result<Vec<u8>, super::state_error::StateError> {
        self.0.export_snapshot(mode)
    }
}

impl<Ports: RoomPorts> Room<Ports> {
    /// Start a cold room with empty volatile memory.
    pub fn new(ports: Ports, config: RoomConfig) -> Self {
        let awareness = EphemeralStore::new(config.awareness_timeout.0);
        Self {
            ports,
            config,
            memory: RoomMemory {
                session_key: None,
                document: None,
                operation_log: None,
                awareness,
                connections: BTreeMap::new(),
                inbound: HashMap::new(),
                pending_blame: Vec::new(),
                pending_editors: BTreeSet::new(),
                mapped_writing_peers: BTreeSet::new(),
                surface_lifecycle: None,
                source_migration: None,
            },
        }
    }
    /// Runtime capabilities supplied by the composition root.
    pub fn ports(&self) -> &Ports {
        &self.ports
    }
    /// Read-only diagnostic memory; adapters cannot mutate or take room fields.
    pub fn memory_view(&self) -> RoomMemoryView<'_> {
        RoomMemoryView {
            session_key: self.memory.session_key.as_ref(),
            document: self.memory.document.as_ref().map(DocumentView),
            mapped_writing_peers: &self.memory.mapped_writing_peers,
        }
    }
}

mod connection;
mod delete;
mod error;
pub use connection::{ConnectOutcome, SocketOf};
pub use error::{PortName, RoomError};

#[cfg(test)]
mod test;

mod frame;
pub use frame::InboundFrame;

mod alarm;
mod atomic;
pub use alarm::AlarmOutcome;

mod debug;
mod http;
mod migration;
pub use migration::{MigrationOutcome, SnapshotExport};
mod fault;
pub use fault::{FaultPlan, FaultPoint};
mod surface;
pub use http::{InitializeOutcome, RequestGate, RouteClass, SnapshotOutcome};
pub use surface::{SurfacePreparation, SurfaceRequest, SurfaceStatus};
