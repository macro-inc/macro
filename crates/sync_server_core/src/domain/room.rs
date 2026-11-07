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
    /// Presence expiration; the clock-injected store replaces Loro's in C9a.
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

/// Temporary field access while callback bodies move inward in C8–C15.
/// No synchronization or runtime handles live here.
#[doc(hidden)]
pub struct RoomMemory {
    /// Cached durable identity.
    pub session_key: Option<SessionKey>,
    /// Live imported document and its monotonic save timestamps.
    pub document: Option<DocumentState>,
    /// Ordered operation IDs and the applied set, reset by H9.
    pub operation_log: Option<OperationLog>,
    /// Existing presence implementation, replaced with explicit time in C9a.
    pub awareness: EphemeralStore,
    /// Restored metadata indexed by the unchanged socket tag.
    pub connections: BTreeMap<WebSocketId, ConnectionMetadata>,
    /// Partial frames indexed by the unchanged socket tag.
    pub inbound: HashMap<WebSocketId, Reassembler>,
    /// Deferred blame observations.
    pub pending_blame: Vec<BlameEvent>,
    /// Distinct editors since the last publication.
    pub pending_editors: BTreeSet<DocumentAttribution>,
    /// Writing peers mapped during this activation.
    pub mapped_writing_peers: BTreeSet<PeerId>,
    /// Cached surface lifecycle.
    pub surface_lifecycle: Option<SurfaceLifecycle>,
    /// Cached source migration state.
    pub source_migration: Option<SourceState>,
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
    /// Temporary mutable adapter access during the callback extraction.
    #[doc(hidden)]
    pub fn ports_mut(&mut self) -> &mut Ports {
        &mut self.ports
    }
    /// Settings supplied by the composition root.
    pub fn config(&self) -> &RoomConfig {
        &self.config
    }
    /// Read-only room memory for diagnostics and the temporary adapter.
    pub fn memory_view(&self) -> &RoomMemory {
        &self.memory
    }
    /// Temporary cross-crate callback access, removed as handlers move inward.
    #[doc(hidden)]
    pub fn memory_mut(&mut self) -> &mut RoomMemory {
        &mut self.memory
    }
}

mod connection;
mod error;
pub use connection::{ConnectOutcome, SocketOf};
pub use error::{PortName, RoomError};

#[cfg(test)]
mod test;

mod frame;
pub use frame::InboundFrame;

mod alarm;
pub use alarm::AlarmOutcome;

mod http;
pub use http::{InitializeOutcome, RequestGate, RouteClass, SnapshotOutcome};
