//! Isolated surface lifecycle and initialization policy.
use super::{FaultPlan, FaultPoint, PortName, Room, RoomError};
use crate::domain::{
    connection::SurfaceLifecycle, ports::*, state::DocumentState, types::SessionKey,
};

/// Surface route group, classified only after adapter path/method validation.
pub enum SurfaceRequest {
    /// Permanent lifecycle tombstone.
    Revoke,
    /// Binary initial snapshot.
    Initialize,
    /// A verified migration control request.
    Migration,
    /// Any ordinary read or connect request.
    Read,
}
/// Surface use-case outcome mapped to the existing empty HTTP response.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SurfaceStatus {
    /// Empty success response.
    Ok,
    /// Another identity, initializer or migration owns the room.
    Conflict,
    /// Surface has been revoked or its sender is no longer authorized.
    Forbidden,
}
/// Continue route-specific parsing only after common surface policy succeeds.
#[derive(Debug, PartialEq, Eq)]
pub enum SurfacePreparation {
    /// Proceed with the route's existing adapter parsing.
    Proceed,
    /// Return without reading the body.
    Return(SurfaceStatus),
}

pub(super) async fn prepare_surface_snapshot<S: SnapshotStore>(
    storage: &S,
    key: &SessionKey,
    snapshot: &[u8],
) -> Result<bool, RoomError> {
    if storage
        .has(key)
        .await
        .map_err(|e| RoomError::port(PortName::Snapshots, e))?
    {
        if storage
            .get(key)
            .await
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?
            != snapshot
        {
            storage
                .delete(key)
                .await
                .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
            return Ok(false);
        }
    } else {
        storage
            .put(key, snapshot)
            .await
            .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
    }
    Ok(true)
}
impl<P: RoomPorts> Room<P> {
    /// Bind the isolated identity, reject revoked/pending rooms, and validate readers.
    pub async fn prepare_surface(
        &mut self,
        key: &SessionKey,
        operation: SurfaceRequest,
    ) -> Result<SurfacePreparation, RoomError> {
        use SurfacePreparation::*;
        let persisted = self
            .ports
            .storage()
            .session_key()
            .await
            .map_err(|e| RoomError::port(PortName::Storage, e))?;
        if persisted.is_some_and(|persisted| persisted != *key) {
            return Ok(Return(SurfaceStatus::Conflict));
        }
        self.maybe_set_session_key(key).await?;
        if matches!(operation, SurfaceRequest::Revoke) {
            return self.revoke_surface().await.map(Return);
        }
        let lifecycle = self.surface_lifecycle().await?;
        if lifecycle == SurfaceLifecycle::Revoked {
            return Ok(Return(SurfaceStatus::Forbidden));
        }
        match operation {
            SurfaceRequest::Migration => return Ok(Proceed),
            SurfaceRequest::Initialize => {
                if self
                    .ports
                    .storage()
                    .target_migration()
                    .await
                    .map_err(|e| RoomError::port(PortName::Storage, e))?
                    .is_some()
                {
                    return Ok(Return(SurfaceStatus::Conflict));
                }
                return Ok(Proceed);
            }
            SurfaceRequest::Read => {}
            SurfaceRequest::Revoke => unreachable!("handled before lifecycle read"),
        }
        if lifecycle != SurfaceLifecycle::Ready {
            return Ok(Return(SurfaceStatus::Conflict));
        }
        self.load_document().await?;
        if !self.validate_surface_sockets(None).await? {
            return Ok(Return(SurfaceStatus::Forbidden));
        }
        Ok(Proceed)
    }
    /// Claim a validated binary seed and persist readiness after durable snapshot IO.
    pub async fn initialize_surface(
        &mut self,
        key: &SessionKey,
        snapshot: &[u8],
        faults: FaultPlan,
    ) -> Result<SurfaceStatus, RoomError> {
        DocumentState::try_from_snapshot(snapshot)?;
        match self.surface_lifecycle().await? {
            SurfaceLifecycle::Revoked => return Ok(SurfaceStatus::Forbidden),
            SurfaceLifecycle::Ready | SurfaceLifecycle::Initializing => {
                return Ok(SurfaceStatus::Conflict);
            }
            SurfaceLifecycle::Pending => {}
        }
        self.memory.surface_lifecycle = Some(SurfaceLifecycle::Initializing);
        let result = async {
            self.ports
                .snapshots()
                .prepare(key)
                .map_err(|e| RoomError::port(PortName::Snapshots, e))?;
            if !prepare_surface_snapshot(self.ports.snapshots(), key, snapshot).await? {
                return Ok(SurfaceStatus::Conflict);
            }
            faults.at(FaultPoint::SurfaceSnapshot)?;
            if self.surface_lifecycle().await? == SurfaceLifecycle::Revoked {
                return Ok(SurfaceStatus::Forbidden);
            }
            self.ports
                .storage()
                .put_surface_lifecycle(SurfaceLifecycle::Ready)
                .await
                .map_err(|e| RoomError::port(PortName::Storage, e))?;
            if self.surface_lifecycle().await? == SurfaceLifecycle::Revoked {
                return Ok(SurfaceStatus::Forbidden);
            }
            self.memory.surface_lifecycle = Some(SurfaceLifecycle::Ready);
            Ok(SurfaceStatus::Ok)
        }
        .await;
        if !matches!(result, Ok(SurfaceStatus::Ok))
            && self.memory.surface_lifecycle != Some(SurfaceLifecycle::Revoked)
        {
            self.memory.surface_lifecycle = None;
        }
        result
    }
    /// Deny before yielding and persist revocation before closing any socket.
    pub async fn revoke_surface(&mut self) -> Result<SurfaceStatus, RoomError> {
        self.memory.surface_lifecycle = Some(SurfaceLifecycle::Revoked);
        self.ports
            .storage()
            .put_surface_lifecycle(SurfaceLifecycle::Revoked)
            .await
            .map_err(|e| RoomError::port(PortName::Storage, e))?;
        for socket in self.ports.connections().all() {
            self.ports
                .connections()
                .close(&socket, CloseReason::SurfaceRevoked)
                .map_err(RoomError::runtime_connections)?;
        }
        Ok(SurfaceStatus::Ok)
    }
    /// Export a ready surface without document existence checks or default-state creation.
    pub async fn surface_snapshot(&mut self) -> Result<Vec<u8>, RoomError> {
        self.load_document().await?;
        Ok(self
            .memory
            .document
            .as_ref()
            .expect("document loaded")
            .export_snapshot(None)?)
    }
}
#[cfg(test)]
mod test;
