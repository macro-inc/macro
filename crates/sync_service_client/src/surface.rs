//! Internal surface lifecycle transport. Callers own legacy ownership checks and
//! the durable metadata journal; no method falls back to document initialization.

use reqwest::StatusCode;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::SyncServiceClient;

#[cfg(test)]
mod test;

/// Persist this identity before starting an initialization or migration.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SurfaceOperationId(pub Uuid);

/// Receipt binding one operation to snapshot bytes, decoded content and both
/// Loro frontiers. A successful retry returns this same verified receipt.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotProof {
    /// Durable operation identity; reuse only for an identical retry.
    pub operation_id: SurfaceOperationId,
    /// Legacy source UUID, or None for a newly seeded isolated surface.
    pub source_id: Option<Uuid>,
    /// SHA-256 of the full snapshot bytes.
    pub digest: String,
    /// SHA-256 of the canonical decoded JSON content.
    pub content_digest: String,
    /// Sorted state frontier (peer string, counter) pairs.
    pub revision: Vec<(String, i32)>,
    /// Sorted operation-log frontier pairs.
    pub oplog_revision: Vec<(String, i32)>,
}

/// Authoritative frozen state, including pending persisted operations.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SurfaceSnapshot {
    /// Verification receipt for these exact bytes.
    pub proof: SnapshotProof,
    /// Full Loro snapshot, not initial Markdown or a shallow client snapshot.
    pub snapshot: Vec<u8>,
}

/// Typed transport failures; an existing snapshot is never treated as success.
#[derive(Debug)]
pub enum SurfaceSyncError {
    /// Request or response decoding failed; retry with the same operation.
    Transport(reqwest::Error),
    /// HTTP rejection, including conflicts (409) and permanent revocation (403).
    Rejected(StatusCode),
}

impl std::fmt::Display for SurfaceSyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(error) => write!(f, "surface sync transport: {error}"),
            Self::Rejected(status) => write!(f, "surface sync rejected: {status}"),
        }
    }
}

impl std::error::Error for SurfaceSyncError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Transport(error) => Some(error),
            Self::Rejected(_) => None,
        }
    }
}

impl SyncServiceClient {
    async fn surface_request(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<reqwest::Response, SurfaceSyncError> {
        let response = self
            .client
            .post(format!("{}{path}", self.url))
            .json(body)
            .send()
            .await
            .map_err(SurfaceSyncError::Transport)?;
        if response.status() != StatusCode::OK {
            return Err(SurfaceSyncError::Rejected(response.status()));
        }
        Ok(response)
    }

    async fn surface_json<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, SurfaceSyncError> {
        self.surface_request(path, body)
            .await?
            .json()
            .await
            .map_err(SurfaceSyncError::Transport)
    }

    /// Seed an isolated surface exactly once. Retries require the same operation
    /// and snapshot; existing document initialization behavior is unchanged.
    pub async fn initialize_surface(
        &self,
        id: Uuid,
        operation_id: SurfaceOperationId,
        snapshot: &[u8],
    ) -> Result<SnapshotProof, SurfaceSyncError> {
        #[derive(Serialize)]
        struct Initialize<'a> {
            operation_id: SurfaceOperationId,
            snapshot: &'a [u8],
        }
        self.surface_json(
            &format!("/surface/{id}/initialize_verified"),
            &Initialize {
                operation_id,
                snapshot,
            },
        )
        .await
    }

    /// Stop legacy writers and export authoritative state. The caller MUST have
    /// ruled out live and soft-deleted Document collisions before invoking this.
    pub async fn freeze_legacy_surface(
        &self,
        id: Uuid,
        operation_id: SurfaceOperationId,
    ) -> Result<SurfaceSnapshot, SurfaceSyncError> {
        #[derive(Serialize)]
        struct Freeze {
            operation_id: SurfaceOperationId,
        }
        self.surface_json(
            &format!("/document/{id}/migration/freeze"),
            &Freeze { operation_id },
        )
        .await
    }

    /// Import into a non-writable isolated target. The source and target UUIDs
    /// must match; conflicting state is never overwritten.
    pub async fn import_surface(
        &self,
        id: Uuid,
        snapshot: &SurfaceSnapshot,
    ) -> Result<SnapshotProof, SurfaceSyncError> {
        self.surface_json(&format!("/surface/{id}/import"), snapshot)
            .await
    }

    /// Read back and verify an import before committing metadata activation.
    pub async fn verify_surface(
        &self,
        id: Uuid,
        proof: &SnapshotProof,
    ) -> Result<SnapshotProof, SurfaceSyncError> {
        self.surface_json(&format!("/surface/{id}/verify"), proof)
            .await
    }

    /// Irreversibly seal the legacy source, then enable the verified target.
    /// Persist commit intent in the caller's journal BEFORE calling this method.
    /// Even on a timeout/error, recover forward: the source may already be sealed.
    /// Activate metadata/token minting only after this operation succeeds.
    pub async fn activate_surface(
        &self,
        id: Uuid,
        proof: &SnapshotProof,
    ) -> Result<SnapshotProof, SurfaceSyncError> {
        self.surface_json(&format!("/surface/{id}/activate"), proof)
            .await
    }

    /// Roll back only the verified original, before activation commit intent.
    /// A thawed operation cannot subsequently be sealed or reused for a freeze.
    pub async fn thaw_legacy_surface(
        &self,
        id: Uuid,
        proof: &SnapshotProof,
    ) -> Result<SnapshotProof, SurfaceSyncError> {
        self.surface_json(&format!("/document/{id}/migration/thaw"), proof)
            .await
    }

    /// Permanently retire a sealed legacy endpoint, retaining its snapshot/log.
    pub async fn retire_legacy_surface(
        &self,
        id: Uuid,
        proof: &SnapshotProof,
    ) -> Result<SnapshotProof, SurfaceSyncError> {
        self.surface_json(&format!("/document/{id}/migration/retire"), proof)
            .await
    }

    /// Permanently deny new and existing surface grants, including pending IDs.
    pub async fn revoke_surface(&self, id: Uuid) -> Result<(), SurfaceSyncError> {
        self.surface_request(
            &format!("/surface/{id}/revoke"),
            &std::collections::BTreeMap::<String, String>::new(),
        )
        .await?;
        Ok(())
    }
}
