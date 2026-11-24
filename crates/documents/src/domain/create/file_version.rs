//! New versions of existing file documents.

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, EntityType};

use super::{DocumentCreator, file_shas};
use crate::domain::models::{AddedFileVersion, DocumentError};
use crate::domain::ports::create::{
    DocumentBytesUpload, DocumentBytesUploadPort, DocumentCreationService,
};

/// Largest file version accepted (100 MiB), the same cap as saving a file
/// through document storage.
pub const MAX_FILE_VERSION_BYTES: usize = 100 * 1024 * 1024;

impl<Svc, MarkdownInit, BytesUpload, MentionTracker>
    DocumentCreator<Svc, MarkdownInit, BytesUpload, MentionTracker>
where
    Svc: DocumentCreationService,
    BytesUpload: DocumentBytesUploadPort,
{
    /// Add `bytes` as the newest version of a file document the receipt
    /// proves the caller can edit.
    ///
    /// Idempotent on content: when the newest version already holds these
    /// bytes (SHA-256), answers it with `created: false`, storing the bytes
    /// under it again so a retry after an interrupted upload converges.
    /// Refuses Markdown, DOCX, PDF and image documents (the first two keep
    /// their content elsewhere, the others serve their first version),
    /// collaborative documents, and more than 100 MiB.
    ///
    /// The new version is recorded before its bytes are stored, and removed
    /// if storing them fails. A concurrent add of the same bytes can answer
    /// that version before it is removed, so callers that add to one
    /// document concurrently serialize their adds (an import's sync lease).
    #[tracing::instrument(
        skip_all,
        fields(document_id = %document.entity().entity_id, bytes = bytes.len(), created),
        err
    )]
    pub async fn add_file_version(
        &self,
        document: EntityAccessReceipt<EditAccessLevel>,
        bytes: Vec<u8>,
    ) -> Result<AddedFileVersion, DocumentError> {
        if document.entity().entity_type != EntityType::Document {
            return Err(DocumentError::BadRequest(
                "access receipt must be for a document".to_string(),
            ));
        }

        if bytes.len() > MAX_FILE_VERSION_BYTES {
            return Err(DocumentError::BadRequest(
                "file exceeds the 100 MiB version limit".to_string(),
            ));
        }

        let document_id = document.entity().entity_id.as_str();
        let hashes = file_shas(&bytes);
        let upload = self
            .document_service
            .begin_file_version(document_id, &hashes.hex)
            .await?;
        let version = upload.version;
        tracing::Span::current().record("created", version.created);

        let stored = self
            .bytes_uploader
            .upload_document_bytes(DocumentBytesUpload {
                presigned_url: upload.presigned_url,
                content_type: upload.content_type,
                base64_sha256: hashes.base64,
                bytes,
            })
            .await;

        // Only a version made for these bytes is removed: an existing one
        // may already hold them from an earlier upload.
        if let Err(error) = stored {
            if version.created {
                self.document_service
                    .discard_file_version(document_id, version.document_version_id)
                    .await;
            }
            return Err(error);
        }

        Ok(version)
    }
}
