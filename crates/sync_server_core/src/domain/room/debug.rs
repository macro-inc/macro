//! Preserve debug storage preparation without exposing mutable room memory.
use super::{PortName, Room, RoomError};
use crate::domain::{operation_log::OperationLog, ports::*};
impl<P: RoomPorts> Room<P> {
    /// Restore the session and prepare its legacy debug-storage handle lazily.
    pub async fn prepare_debug_storage(&mut self) -> Result<(), RoomError> {
        let key = self.session_key().await?;
        if self.memory.operation_log.is_none() {
            self.ports
                .snapshots()
                .prepare(&key)
                .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
            self.memory.operation_log = Some(OperationLog::new(key.clone(), key.kind()));
        }
        Ok(())
    }
}
