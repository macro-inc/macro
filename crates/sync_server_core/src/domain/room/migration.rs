//! Recoverable session transfers; transport adapters choose routes and fault inputs.
use super::{FaultPlan, FaultPoint, PortName, Room, RoomError};
use crate::domain::{
    connection::SurfaceLifecycle,
    migration::{SnapshotProof, SourceState, TargetPhase, TargetState},
    operation_log::OperationLog,
    ports::*,
    state::DocumentState,
    types::SessionKey,
};
use loro::{Frontiers, VersionVector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid_types::Uuid;
type Result<T> = std::result::Result<T, RoomError>;
/// Transport-neutral migration response.
pub enum MigrationOutcome {
    /// Invalid JSON, UUID or proof.
    BadRequest,
    /// A different operation, receipt or lifecycle owns this room.
    Conflict,
    /// No source snapshot or supported operation exists.
    NotFound,
    /// Durable migration receipt.
    Proof(SnapshotProof),
    /// Frozen snapshot and receipt.
    Export(SnapshotExport),
}
fn snap_error<E: std::error::Error + 'static>(error: E) -> RoomError {
    RoomError::port(PortName::Snapshots, error)
}
fn snap_read<E: std::error::Error + 'static>(error: SnapshotReadError<E>) -> RoomError {
    RoomError::port(PortName::Snapshots, error)
}
fn store_error<E: std::error::Error + 'static>(error: E) -> RoomError {
    RoomError::port(PortName::Storage, error)
}
trait MigrationContext<T> {
    fn context(self, context: &'static str) -> Result<T>;
}
impl<T, E: std::fmt::Debug> MigrationContext<T> for std::result::Result<T, E> {
    fn context(self, context: &'static str) -> Result<T> {
        self.map_err(|error| RoomError::MigrationContext {
            context,
            error: format!("{error:?}"),
        })
    }
}
/// Frozen snapshot and its durable migration receipt.
#[derive(Serialize, Deserialize)]
pub struct SnapshotExport {
    /// Frozen content evidence.
    pub proof: SnapshotProof,
    /// Exact exported snapshot bytes.
    pub snapshot: Vec<u8>,
}

#[derive(Deserialize)]
struct FreezeRequest {
    operation_id: Uuid,
}

#[derive(Deserialize)]
struct InitializeRequest {
    operation_id: Uuid,
    snapshot: Vec<u8>,
}

fn revision(frontiers: Frontiers) -> Vec<(String, i32)> {
    let mut ids: Vec<_> = frontiers
        .iter()
        .map(|id| (id.peer.to_string(), id.counter))
        .collect();
    ids.sort();
    ids
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

trait SnapshotProofExt: Sized {
    fn from_snapshot(operation_id: Uuid, source_id: Option<Uuid>, snapshot: &[u8]) -> Result<Self>;
    fn verifies(&self, snapshot: &[u8]) -> Result<bool>;
}

impl SnapshotProofExt for SnapshotProof {
    fn from_snapshot(operation_id: Uuid, source_id: Option<Uuid>, snapshot: &[u8]) -> Result<Self> {
        let state = DocumentState::try_from_snapshot(snapshot)?;
        // Canonical JSON key order, independent of CRDT map iteration order.
        let mut content: serde_json::Value =
            serde_json::from_str(&state.get_json()).context("migration content JSON")?;
        content.sort_all_objects();
        Ok(Self {
            operation_id,
            source_id,
            digest: digest(snapshot),
            content_digest: digest(
                &serde_json::to_vec(&content).context("migration content JSON")?,
            ),
            revision: revision(state.loro_doc.state_frontiers()),
            oplog_revision: revision(state.loro_doc.oplog_frontiers()),
        })
    }

    fn verifies(&self, snapshot: &[u8]) -> Result<bool> {
        Ok(*self == Self::from_snapshot(self.operation_id, self.source_id, snapshot)?)
    }
}

impl<P: RoomPorts> Room<P> {
    async fn source_state(&mut self) -> Result<SourceState> {
        if let Some(value) = self.memory.source_migration.clone() {
            return Ok(value);
        }
        let value = self
            .ports
            .storage()
            .source_migration()
            .await
            .map_err(store_error)?
            .unwrap_or_default();
        self.memory.source_migration = Some(value.clone());
        Ok(value)
    }
    async fn store_source(&mut self, value: SourceState) -> Result<()> {
        self.memory.source_migration = None;
        self.ports
            .storage()
            .put_source_migration(&value)
            .await
            .map_err(store_error)?;
        self.memory.source_migration = Some(value);
        Ok(())
    }
    fn close_migration_writers(&self) -> Result<()> {
        for socket in self.ports.connections().all() {
            self.ports
                .connections()
                .close(&socket, CloseReason::SessionFrozenOrRetired)
                .map_err(RoomError::runtime_connections)?;
        }
        Ok(())
    }
    async fn authoritative_snapshot(&mut self) -> Result<Vec<u8>> {
        let key = self.session_key().await?;
        if self.memory.operation_log.is_none() {
            // The legacy cold session-storage constructor prepares its own SQL
            // backend even after the detached freeze existence check.
            self.ports.snapshots().prepare(&key).map_err(snap_error)?;
            self.memory.operation_log = Some(OperationLog::new(key.clone(), key.kind()));
        }
        let state = DocumentState::try_from_snapshot(
            &self.ports.snapshots().get(&key).await.map_err(snap_read)?,
        )?;
        let mut updates: Vec<Vec<u8>> = self
            .ports
            .storage()
            .pending_operations()
            .await
            .map_err(store_error)?
            .into_iter()
            .map(|entry| entry.map(|op| op.update).map_err(store_error))
            .collect::<Result<_>>()?;
        if let Some(current) = self.memory.document.as_ref() {
            updates.push(current.export_snapshot(None)?);
        }
        let imported = state
            .loro_doc
            .import_batch(&updates)
            .context("replay frozen operation log")?;
        if imported.pending.is_some() {
            return Err(RoomError::MigrationPending);
        }
        if let Some(bytes) = self
            .ports
            .storage()
            .saved_version_vector()
            .await
            .map_err(store_error)?
        {
            let saved = VersionVector::decode(&bytes).context("invalid saved revision")?;
            if !matches!(
                state.loro_doc.oplog_vv().partial_cmp(&saved),
                Some(std::cmp::Ordering::Equal | std::cmp::Ordering::Greater)
            ) {
                return Err(RoomError::MigrationBehindSaved);
            }
        }
        Ok(state.export_snapshot(None)?)
    }
    /// Apply a parsed source control route, preserving its durable receipt and fault order.
    pub async fn source_migration(
        &mut self,
        body: &[u8],
        faults: FaultPlan,
        id: &str,
        operation: &str,
    ) -> Result<MigrationOutcome> {
        let Ok(source_id) = Uuid::parse_str(id) else {
            return Ok(MigrationOutcome::BadRequest);
        };
        if operation == "freeze" {
            let Ok(body) = serde_json::from_slice::<FreezeRequest>(body) else {
                return Ok(MigrationOutcome::BadRequest);
            };
            return self
                .freeze_source(faults, id, source_id, body.operation_id)
                .await;
        }
        if !matches!(operation, "thaw" | "seal" | "retire") {
            return Ok(MigrationOutcome::NotFound);
        }
        let Ok(proof) = serde_json::from_slice::<SnapshotProof>(body) else {
            return Ok(MigrationOutcome::BadRequest);
        };
        if proof.source_id != Some(source_id) {
            return Ok(MigrationOutcome::Conflict);
        }
        let current = self.source_state().await?;
        let next = match (operation, &current) {
            ("thaw", SourceState::Frozen(expected) | SourceState::Thawed(expected))
                if *expected == proof =>
            {
                self.maybe_set_session_key(&SessionKey::new(id.to_owned()))
                    .await?;
                let snapshot = self.authoritative_snapshot().await?;
                // Snapshot serialization need not be byte-stable on replay. Verify
                // both frontiers and decoded content against the original proof.
                let actual =
                    SnapshotProof::from_snapshot(proof.operation_id, proof.source_id, &snapshot)?;
                if actual.revision != proof.revision
                    || actual.oplog_revision != proof.oplog_revision
                    || actual.content_digest != proof.content_digest
                {
                    return Ok(MigrationOutcome::Conflict);
                }
                SourceState::Thawed(proof.clone())
            }
            (
                "seal",
                SourceState::Frozen(expected)
                | SourceState::Sealed(expected)
                | SourceState::Retired(expected),
            ) if *expected == proof => {
                if matches!(current, SourceState::Retired(_)) {
                    return Ok(MigrationOutcome::Proof(proof));
                }
                SourceState::Sealed(proof.clone())
            }
            ("retire", SourceState::Sealed(expected) | SourceState::Retired(expected))
                if *expected == proof =>
            {
                SourceState::Retired(proof.clone())
            }
            _ => return Ok(MigrationOutcome::Conflict),
        };
        self.store_source(next).await?;
        faults.at(match operation {
            "thaw" => FaultPoint::SourceThawed,
            "seal" => FaultPoint::SourceSealed,
            _ => FaultPoint::SourceRetired,
        })?;
        if operation != "thaw" {
            self.close_migration_writers()?;
        }
        Ok(MigrationOutcome::Proof(proof))
    }

    async fn freeze_source(
        &mut self,
        faults: FaultPlan,
        id: &str,
        source_id: Uuid,
        operation_id: Uuid,
    ) -> Result<MigrationOutcome> {
        match self.source_state().await? {
            SourceState::Frozen(proof)
            | SourceState::Sealed(proof)
            | SourceState::Retired(proof)
                if proof.operation_id == operation_id =>
            {
                self.close_migration_writers()?;
                let snapshot = self
                    .ports
                    .snapshots()
                    .export(operation_id)
                    .await
                    .map_err(snap_read)?;
                if !proof.verifies(&snapshot)? {
                    return Ok(MigrationOutcome::Conflict);
                }
                return Ok(MigrationOutcome::Export(SnapshotExport { proof, snapshot }));
            }
            SourceState::Freezing(expected) if expected == operation_id => {}
            SourceState::Live => {}
            SourceState::Thawed(proof) if proof.operation_id != operation_id => {}
            _ => return Ok(MigrationOutcome::Conflict),
        }
        let key = SessionKey::new(id.to_owned());
        self.ports.snapshots().prepare(&key).map_err(snap_error)?;
        if !self.ports.snapshots().has(&key).await.map_err(snap_error)? {
            return Ok(MigrationOutcome::NotFound);
        }
        self.maybe_set_session_key(&SessionKey::new(id.to_owned()))
            .await?;
        self.store_source(SourceState::Freezing(operation_id))
            .await?;
        faults.at(FaultPoint::SourceClaim)?;
        self.close_migration_writers()?;
        let snapshot = self.authoritative_snapshot().await?;
        let proof = SnapshotProof::from_snapshot(operation_id, Some(source_id), &snapshot)?;
        self.ports
            .snapshots()
            .put_export(operation_id, &snapshot)
            .await
            .map_err(snap_error)?;
        faults.at(FaultPoint::SourceExport)?;
        self.store_source(SourceState::Frozen(proof.clone()))
            .await?;
        faults.at(FaultPoint::SourceFrozen)?;
        Ok(MigrationOutcome::Export(SnapshotExport { proof, snapshot }))
    }

    /// Import, verify or activate an isolated target with exact snapshot proof checks.
    pub async fn target_migration(
        &mut self,
        body: &[u8],
        faults: FaultPlan,
        key: &str,
        operation: &str,
    ) -> Result<MigrationOutcome> {
        if matches!(operation, "initialize_verified" | "import") {
            let export = if operation == "initialize_verified" {
                let Ok(body) = serde_json::from_slice::<InitializeRequest>(body) else {
                    return Ok(MigrationOutcome::BadRequest);
                };
                let Ok(proof) =
                    SnapshotProof::from_snapshot(body.operation_id, None, &body.snapshot)
                else {
                    return Ok(MigrationOutcome::BadRequest);
                };
                SnapshotExport {
                    proof,
                    snapshot: body.snapshot,
                }
            } else {
                let Ok(body) = serde_json::from_slice::<SnapshotExport>(body) else {
                    return Ok(MigrationOutcome::BadRequest);
                };
                // Legacy surfaces keep their UUID when moving to the isolated
                // namespace. This also binds source sealing to exactly one target.
                if body.proof.source_id.map(|id| format!("surface:{id}")) != Some(key.to_owned()) {
                    return Ok(MigrationOutcome::Conflict);
                }
                body
            };
            if !export.proof.verifies(&export.snapshot).unwrap_or(false) {
                return Ok(MigrationOutcome::BadRequest);
            }
            return self
                .import_surface(faults, key, export, operation == "initialize_verified")
                .await;
        }
        let Ok(proof) = serde_json::from_slice::<SnapshotProof>(body) else {
            return Ok(MigrationOutcome::BadRequest);
        };
        let Some(mut target) = self
            .ports
            .storage()
            .target_migration()
            .await
            .map_err(store_error)?
        else {
            return Ok(MigrationOutcome::Conflict);
        };
        if target.proof != proof || target.phase == TargetPhase::Claimed {
            return Ok(MigrationOutcome::Conflict);
        }
        if target.phase != TargetPhase::Active {
            let storage_key = SessionKey::new(key.to_owned());
            self.ports
                .snapshots()
                .prepare(&storage_key)
                .map_err(snap_error)?;
            let snapshot = self
                .ports
                .snapshots()
                .get(&storage_key)
                .await
                .map_err(snap_read)?;
            if !proof.verifies(&snapshot)? {
                return Ok(MigrationOutcome::Conflict);
            }
        }
        if operation == "activate" {
            target.phase = TargetPhase::Active;
            self.ports
                .storage()
                .put_target_migration(&target)
                .await
                .map_err(store_error)?;
            faults.at(FaultPoint::TargetActive)?;
            self.mark_target_ready(faults).await?;
        }
        Ok(MigrationOutcome::Proof(target.proof))
    }

    async fn import_surface(
        &mut self,
        faults: FaultPlan,
        key: &str,
        export: SnapshotExport,
        initialize: bool,
    ) -> Result<MigrationOutcome> {
        let key = SessionKey::new(key.to_owned());
        self.ports.snapshots().prepare(&key).map_err(snap_error)?;
        let target: Option<TargetState> = self
            .ports
            .storage()
            .target_migration()
            .await
            .map_err(store_error)?;
        let mut target = if let Some(target) = target {
            if target.proof != export.proof {
                return Ok(MigrationOutcome::Conflict);
            }
            target
        } else {
            if self.surface_lifecycle().await? != SurfaceLifecycle::Pending
                || self.ports.snapshots().has(&key).await.map_err(snap_error)?
            {
                return Ok(MigrationOutcome::Conflict);
            }
            let target = TargetState {
                proof: export.proof,
                phase: TargetPhase::Claimed,
            };
            self.ports
                .storage()
                .put_target_migration(&target)
                .await
                .map_err(store_error)?;
            faults.at(FaultPoint::TargetClaim)?;
            target
        };
        // Once active, edits are allowed. A replay of the original operation
        // returns its durable receipt, never overwriting or re-verifying live data.
        if target.phase != TargetPhase::Active {
            if !self.ports.snapshots().has(&key).await.map_err(snap_error)? {
                self.ports
                    .snapshots()
                    .put(&key, &export.snapshot)
                    .await
                    .map_err(snap_error)?;
                faults.at(FaultPoint::TargetSnapshot)?;
            }
            // Read back and decode, verifying content, both frontiers and bytes.
            if !target
                .proof
                .verifies(&self.ports.snapshots().get(&key).await.map_err(snap_read)?)?
            {
                return Ok(MigrationOutcome::Conflict);
            }
            target.phase = TargetPhase::Verified;
            self.ports
                .storage()
                .put_target_migration(&target)
                .await
                .map_err(store_error)?;
            faults.at(FaultPoint::TargetVerified)?;
        }
        if initialize {
            target.phase = TargetPhase::Active;
            self.ports
                .storage()
                .put_target_migration(&target)
                .await
                .map_err(store_error)?;
            faults.at(FaultPoint::TargetActive)?;
            self.mark_target_ready(faults).await?;
        }
        Ok(MigrationOutcome::Proof(target.proof))
    }

    async fn mark_target_ready(&mut self, faults: FaultPlan) -> Result<()> {
        self.ports
            .storage()
            .put_surface_lifecycle(SurfaceLifecycle::Ready)
            .await
            .map_err(store_error)?;
        self.memory.surface_lifecycle = Some(SurfaceLifecycle::Ready);
        faults.at(FaultPoint::TargetReady)
    }
}
