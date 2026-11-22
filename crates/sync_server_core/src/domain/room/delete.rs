//! Permanent session erasure, retaining the existing mapped-peer cache quirk.
use super::{PortName, Room, RoomError};
use crate::domain::{ports::*, types::SessionKey};

impl<P: RoomPorts> Room<P> {
    /// Close sockets before deleting attribution, fallback/primary snapshots and room storage.
    pub async fn delete(&mut self, key: &SessionKey) -> Result<(), RoomError> {
        for socket in self.ports.connections().all() {
            if let Err(error) = self
                .ports
                .connections()
                .close(&socket, CloseReason::DocumentDeleted)
            {
                tracing::warn!(error = ?error, "failed to close socket of deleted document");
            }
        }
        self.ports
            .peers()
            .delete_document(key)
            .await
            .map_err(|e| RoomError::port(PortName::Peers, e))?;
        self.ports
            .snapshots()
            .prepare(key)
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
        self.ports
            .snapshots()
            .delete(key)
            .await
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
        self.ports
            .alarm()
            .cancel()
            .await
            .map_err(|e| RoomError::port(PortName::Alarm, e))?;
        self.ports
            .storage()
            .delete_all()
            .await
            .map_err(|e| RoomError::port(PortName::Storage, e))?;
        self.memory.session_key = None;
        self.memory.document = None;
        self.memory.operation_log = None;
        self.memory.surface_lifecycle = None;
        self.memory.source_migration = None;
        self.memory.connections.clear();
        self.memory.inbound.clear();
        self.memory.pending_blame.clear();
        self.memory.pending_editors.clear();
        // Keep the store's tombstones and mapped_writing_peers, as forget_session did.
        for key in self.memory.awareness.keys() {
            self.memory
                .awareness
                .delete(&key, self.ports.clock().unix_time());
        }
        Ok(())
    }
}
