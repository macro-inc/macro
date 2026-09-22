//! Recoverable, internal-only session transfers. The caller must first verify
//! legacy ownership through the documents domain. This module never infers it.
//!
//! Freeze drains the callback barrier and preserves the original snapshot/log.
//! Activation seals the source in the outer worker BEFORE enabling the target:
//! a crash can leave both unavailable, but can never leave two writable copies.
//! Sealing is the irreversible commit intent; recovery thereafter is forward-only.

use loro::{Frontiers, VersionVector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use worker::{Method, Request, Response, Result};

use super::{
    DocumentSyncSession, response,
    surface_api::{LIFECYCLE_KEY, SurfaceLifecycle},
};
use crate::{
    auth::is_internal,
    error::ResultExt,
    state::DocumentState,
    storage::{
        backends::durable_sql::DurableSQLStorage, get_snapshot_storage, snapshot::SnapshotStorage,
    },
};

const SOURCE_KEY: &str = "SURFACE_MIGRATION_SOURCE";
const TARGET_KEY: &str = "SURFACE_MIGRATION_TARGET";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SnapshotProof {
    pub operation_id: Uuid,
    pub source_id: Option<Uuid>,
    pub digest: String,
    pub content_digest: String,
    pub revision: Vec<(String, i32)>,
    pub oplog_revision: Vec<(String, i32)>,
}

#[derive(Serialize, Deserialize)]
struct SnapshotExport {
    proof: SnapshotProof,
    snapshot: Vec<u8>,
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

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(tag = "phase", content = "proof", rename_all = "snake_case")]
pub(super) enum SourceState {
    #[default]
    Live,
    Freezing(Uuid),
    Frozen(SnapshotProof),
    Sealed(SnapshotProof),
    Retired(SnapshotProof),
    Thawed(SnapshotProof),
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TargetPhase {
    Claimed,
    Verified,
    Active,
}

#[derive(Serialize, Deserialize)]
struct TargetState {
    proof: SnapshotProof,
    phase: TargetPhase,
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

impl SnapshotProof {
    fn from_snapshot(operation_id: Uuid, source_id: Option<Uuid>, snapshot: &[u8]) -> Result<Self> {
        let state = DocumentState::try_from_snapshot(snapshot)?;
        // Canonical JSON key order, independent of CRDT map iteration order.
        let mut content: serde_json::Value = serde_json::from_str(&state.get_json())?;
        content.sort_all_objects();
        Ok(Self {
            operation_id,
            source_id,
            digest: digest(snapshot),
            content_digest: digest(&serde_json::to_vec(&content)?),
            revision: revision(state.loro_doc.state_frontiers()),
            oplog_revision: revision(state.loro_doc.oplog_frontiers()),
        })
    }

    fn verifies(&self, snapshot: &[u8]) -> Result<bool> {
        Ok(*self == Self::from_snapshot(self.operation_id, self.source_id, snapshot)?)
    }
}

/// Fault injection is absent from production builds, even for internal callers.
fn persistence_boundary(req: &Request, boundary: &str) -> Result<()> {
    #[cfg(feature = "migration-test-hooks")]
    if req.headers().get("x-sync-test-stop-after")?.as_deref() == Some(boundary) {
        return Err(worker::Error::from(
            "injected migration persistence failure",
        ));
    }
    let _ = (req, boundary);
    Ok(())
}

impl DocumentSyncSession {
    async fn source_state(&self) -> Result<SourceState> {
        if let Some(value) = self.source_migration.lock("source state").clone() {
            return Ok(value);
        }
        let value: SourceState = self
            .state
            .storage()
            .get(SOURCE_KEY)
            .await?
            .unwrap_or_default();
        *self.source_migration.lock("load source state") = Some(value.clone());
        Ok(value)
    }

    pub(super) async fn source_blocked(&self) -> Result<bool> {
        Ok(!matches!(
            self.source_state().await?,
            SourceState::Live | SourceState::Thawed(_)
        ))
    }

    async fn store_source(&self, value: SourceState) -> Result<()> {
        // A failed write may have committed. Reload durable truth on the next
        // callback instead of retaining a potentially stale writable cache.
        *self.source_migration.lock("invalidate source state") = None;
        self.state.storage().put(SOURCE_KEY, &value).await?;
        *self.source_migration.lock("persist source state") = Some(value);
        Ok(())
    }

    fn close_migration_writers(&self) -> Result<()> {
        for socket in self.state.get_websockets() {
            socket.close(Some(1008), Some("session frozen or retired"))?;
        }
        Ok(())
    }

    fn export_storage(&self, operation_id: Uuid) -> Result<DurableSQLStorage> {
        // Separate, chunked local storage: never replace the original snapshot,
        // never clear its operation log, and never depend on eventual KV reads.
        DurableSQLStorage::new(
            self.state.storage(),
            format!("migration-export:{operation_id}"),
        )
    }

    async fn authoritative_snapshot(&self) -> Result<Vec<u8>> {
        let storage = self.session_storage().await?;
        // Strict loading: missing snapshots must not invoke create-default-state;
        // malformed pending entries must not be silently skipped.
        let state = DocumentState::try_from_snapshot(&storage.get_snapshot().await?)?;
        let mut updates: Vec<Vec<u8>> = storage
            .get_pending_operations()
            .await?
            .into_iter()
            .map(|entry| entry.map(|(_, bytes)| bytes))
            .collect::<Result<_>>()?;
        if let Some(current) = self.document_state.lock("freeze current state").as_ref() {
            updates.push(current.export_snapshot(None)?);
        }
        let imported = state
            .loro_doc
            .import_batch(&updates)
            .context("replay frozen operation log")?;
        if imported.pending.is_some() {
            return Err(worker::Error::from(
                "migration has unresolved pending operations",
            ));
        }
        if let Some(bytes) = storage.debug_do_kv_get("LAST_VERSION_VECTOR").await? {
            let saved = VersionVector::decode(&bytes).context("invalid saved revision")?;
            if !matches!(
                state.loro_doc.oplog_vv().partial_cmp(&saved),
                Some(std::cmp::Ordering::Equal | std::cmp::Ordering::Greater)
            ) {
                return Err(worker::Error::from(
                    "migration snapshot is behind saved revision",
                ));
            }
        }
        state.export_snapshot(None)
    }

    pub(super) async fn source_migration_handler(
        &self,
        mut req: Request,
        id: &str,
        operation: &str,
    ) -> Result<Response> {
        if !is_internal(&req, &self.env)? {
            return Ok(response(401));
        }
        if req.method() != Method::Post {
            return Ok(response(405));
        }
        let Ok(source_id) = Uuid::parse_str(id) else {
            return Ok(response(400));
        };
        if operation == "freeze" {
            let Ok(body) = req.json::<FreezeRequest>().await else {
                return Ok(response(400));
            };
            return self
                .freeze_source(&req, id, source_id, body.operation_id)
                .await;
        }
        if !matches!(operation, "thaw" | "seal" | "retire") {
            return Ok(response(404));
        }
        let Ok(proof) = req.json::<SnapshotProof>().await else {
            return Ok(response(400));
        };
        if proof.source_id != Some(source_id) {
            return Ok(response(409));
        }
        let current = self.source_state().await?;
        let next = match (operation, &current) {
            ("thaw", SourceState::Frozen(expected) | SourceState::Thawed(expected))
                if *expected == proof =>
            {
                self.maybe_set_document_id(id).await?;
                let snapshot = self.authoritative_snapshot().await?;
                // Snapshot serialization need not be byte-stable on replay. Verify
                // both frontiers and decoded content against the original proof.
                let actual =
                    SnapshotProof::from_snapshot(proof.operation_id, proof.source_id, &snapshot)?;
                if actual.revision != proof.revision
                    || actual.oplog_revision != proof.oplog_revision
                    || actual.content_digest != proof.content_digest
                {
                    return Ok(response(409));
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
                    return Response::from_json(&proof);
                }
                SourceState::Sealed(proof.clone())
            }
            ("retire", SourceState::Sealed(expected) | SourceState::Retired(expected))
                if *expected == proof =>
            {
                SourceState::Retired(proof.clone())
            }
            _ => return Ok(response(409)),
        };
        self.store_source(next).await?;
        persistence_boundary(
            &req,
            match operation {
                "thaw" => "source_thawed",
                "seal" => "source_sealed",
                _ => "source_retired",
            },
        )?;
        if operation != "thaw" {
            self.close_migration_writers()?;
        }
        Response::from_json(&proof)
    }

    async fn freeze_source(
        &self,
        req: &Request,
        id: &str,
        source_id: Uuid,
        operation_id: Uuid,
    ) -> Result<Response> {
        match self.source_state().await? {
            SourceState::Frozen(proof)
            | SourceState::Sealed(proof)
            | SourceState::Retired(proof)
                if proof.operation_id == operation_id =>
            {
                self.close_migration_writers()?;
                let snapshot = self.export_storage(operation_id)?.get_snapshot().await?;
                if !proof.verifies(&snapshot)? {
                    return Ok(response(409));
                }
                return Response::from_json(&SnapshotExport { proof, snapshot });
            }
            SourceState::Freezing(expected) if expected == operation_id => {}
            SourceState::Live => {}
            SourceState::Thawed(proof) if proof.operation_id != operation_id => {}
            _ => return Ok(response(409)),
        }
        let storage = get_snapshot_storage(&self.env, &self.state, id.to_owned())?;
        if !storage.has_snapshot().await? {
            return Ok(response(404));
        }
        self.maybe_set_document_id(id).await?;
        self.store_source(SourceState::Freezing(operation_id))
            .await?;
        persistence_boundary(req, "source_claim")?;
        self.close_migration_writers()?;
        let snapshot = self.authoritative_snapshot().await?;
        let proof = SnapshotProof::from_snapshot(operation_id, Some(source_id), &snapshot)?;
        self.export_storage(operation_id)?
            .store_snapshot(&snapshot)
            .await?;
        persistence_boundary(req, "source_export")?;
        self.store_source(SourceState::Frozen(proof.clone()))
            .await?;
        persistence_boundary(req, "source_frozen")?;
        Response::from_json(&SnapshotExport { proof, snapshot })
    }

    pub(super) async fn has_target_migration(&self) -> Result<bool> {
        Ok(self
            .state
            .storage()
            .get::<TargetState>(TARGET_KEY)
            .await?
            .is_some())
    }

    pub(super) async fn target_migration_handler(
        &self,
        mut req: Request,
        key: &str,
        operation: &str,
    ) -> Result<Response> {
        if matches!(operation, "initialize_verified" | "import") {
            let export = if operation == "initialize_verified" {
                let Ok(body) = req.json::<InitializeRequest>().await else {
                    return Ok(response(400));
                };
                let Ok(proof) =
                    SnapshotProof::from_snapshot(body.operation_id, None, &body.snapshot)
                else {
                    return Ok(response(400));
                };
                SnapshotExport {
                    proof,
                    snapshot: body.snapshot,
                }
            } else {
                let Ok(body) = req.json::<SnapshotExport>().await else {
                    return Ok(response(400));
                };
                // Legacy surfaces keep their UUID when moving to the isolated
                // namespace. This also binds source sealing to exactly one target.
                if body.proof.source_id.map(|id| format!("surface:{id}")) != Some(key.to_owned()) {
                    return Ok(response(409));
                }
                body
            };
            if !export.proof.verifies(&export.snapshot).unwrap_or(false) {
                return Ok(response(400));
            }
            return self
                .import_surface(&req, key, export, operation == "initialize_verified")
                .await;
        }
        let Ok(proof) = req.json::<SnapshotProof>().await else {
            return Ok(response(400));
        };
        let Some(mut target) = self.state.storage().get::<TargetState>(TARGET_KEY).await? else {
            return Ok(response(409));
        };
        if target.proof != proof || target.phase == TargetPhase::Claimed {
            return Ok(response(409));
        }
        if target.phase != TargetPhase::Active {
            let snapshot = get_snapshot_storage(&self.env, &self.state, key.to_owned())?
                .get_snapshot()
                .await?;
            if !proof.verifies(&snapshot)? {
                return Ok(response(409));
            }
        }
        if operation == "activate" {
            target.phase = TargetPhase::Active;
            self.state.storage().put(TARGET_KEY, &target).await?;
            persistence_boundary(&req, "target_active")?;
            self.mark_target_ready(&req).await?;
        }
        Response::from_json(&target.proof)
    }

    async fn import_surface(
        &self,
        req: &Request,
        key: &str,
        export: SnapshotExport,
        initialize: bool,
    ) -> Result<Response> {
        let storage = get_snapshot_storage(&self.env, &self.state, key.to_owned())?;
        let target: Option<TargetState> = self.state.storage().get(TARGET_KEY).await?;
        let mut target = if let Some(target) = target {
            if target.proof != export.proof {
                return Ok(response(409));
            }
            target
        } else {
            if self.surface_lifecycle().await? != SurfaceLifecycle::Pending
                || storage.has_snapshot().await?
            {
                return Ok(response(409));
            }
            let target = TargetState {
                proof: export.proof,
                phase: TargetPhase::Claimed,
            };
            self.state.storage().put(TARGET_KEY, &target).await?;
            persistence_boundary(req, "target_claim")?;
            target
        };
        // Once active, edits are allowed. A replay of the original operation
        // returns its durable receipt, never overwriting or re-verifying live data.
        if target.phase != TargetPhase::Active {
            if !storage.has_snapshot().await? {
                storage.store_snapshot(&export.snapshot).await?;
                persistence_boundary(req, "target_snapshot")?;
            }
            // Read back and decode, verifying content, both frontiers and bytes.
            if !target.proof.verifies(&storage.get_snapshot().await?)? {
                return Ok(response(409));
            }
            target.phase = TargetPhase::Verified;
            self.state.storage().put(TARGET_KEY, &target).await?;
            persistence_boundary(req, "target_verified")?;
        }
        if initialize {
            target.phase = TargetPhase::Active;
            self.state.storage().put(TARGET_KEY, &target).await?;
            persistence_boundary(req, "target_active")?;
            self.mark_target_ready(req).await?;
        }
        Response::from_json(&target.proof)
    }

    async fn mark_target_ready(&self, req: &Request) -> Result<()> {
        self.state
            .storage()
            .put(LIFECYCLE_KEY, SurfaceLifecycle::Ready)
            .await?;
        *self.surface_lifecycle.lock("verified surface ready") = Some(SurfaceLifecycle::Ready);
        persistence_boundary(req, "target_ready")
    }
}
