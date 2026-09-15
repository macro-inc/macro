//! Re-hosting collected files on Macro's static file service.
//!
//! A provider's own download url expires — Cursor's in fifteen minutes — so a
//! file that is to stay readable in a session log has to be copied somewhere
//! that outlives it before the log ever points at it. The static file service
//! is that somewhere: it hands back a permalink under the static-file CDN,
//! which serves the object without an Authorization header, so the url can go
//! straight into an `<img>` or `<video>` the way the log's readers need.

use static_file_service_client::StaticFileServiceClient;

use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::{ArtifactStore, ArtifactUpload, StoredArtifact};

/// An [`ArtifactStore`] backed by the static file service.
pub struct StaticFileArtifactStore {
    files: StaticFileServiceClient,
}

impl StaticFileArtifactStore {
    /// Store files through `files`.
    #[must_use]
    pub fn new(files: StaticFileServiceClient) -> Self {
        Self { files }
    }
}

impl ArtifactStore for StaticFileArtifactStore {
    #[tracing::instrument(
        name = "artifacts.store",
        skip_all,
        err,
        fields(
            artifact.name = %upload.file_name,
            artifact.mime_type = %upload.mime_type,
            artifact.size_bytes = upload.bytes.len(),
        )
    )]
    async fn store(&self, upload: ArtifactUpload) -> Result<StoredArtifact> {
        let stored = self
            .files
            .put_named_bytes(&upload.file_name, upload.bytes, &upload.mime_type)
            .await
            .map_err(|error| {
                HarnessError::Artifacts(rootcause::report!("could not store an artifact: {error}"))
            })?;
        Ok(StoredArtifact {
            uri: stored.file_location,
        })
    }
}
