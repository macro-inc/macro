//! Reserving versions of file documents for new bytes.
use super::*;
use crate::domain::models::AddedFileVersion;
use crate::domain::ports::create::FileVersionUpload;

/// Whether a document of `file_type` serves its newest `DocumentInstance`.
/// PDF and image documents serve their first; Markdown and DOCX keep their
/// content elsewhere.
fn serves_newest_instance(file_type: FileType) -> bool {
    file_type != FileType::Md && file_type != FileType::Docx && !file_type.is_static()
}

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
    S: DocumentSyncPort,
> DocumentServiceImpl<R, U, T, C, Eam, F, B, S>
{
    pub(super) async fn reserve_file_version(
        &self,
        document_id: &str,
        sha: &str,
    ) -> Result<FileVersionUpload, DocumentError> {
        let document = self
            .repo
            .get_basic_document(document_id)
            .await
            .map_err(|error| map_basic_document_error(document_id, error.into()))?;
        if document.deleted_at.is_some() {
            return Err(DocumentError::NotFound(document_id.to_string()));
        }

        // An untyped document serves its first instance, like a PDF.
        let file_type = document
            .file_type
            .as_deref()
            .and_then(|file_type| FileType::from_str(file_type).ok())
            .filter(|file_type| serves_newest_instance(*file_type))
            .ok_or_else(|| {
                DocumentError::BadRequest(format!(
                    "a {} document cannot take a new file version",
                    document.file_type.as_deref().unwrap_or("untyped")
                ))
            })?;

        // Collaborative types keep their content in the sync service, so a
        // stored file would never be what they serve.
        let content = self
            .content_for_document(document_id, Some(file_type))
            .await?;
        if content.location != Some(DocumentContentLocation::ObjectStorage) {
            return Err(DocumentError::BadRequest(format!(
                "a {file_type} document keeps its content outside file storage"
            )));
        }

        let version = self
            .repo
            .add_document_instance(document_id, file_type, sha)
            .await
            .map_err(|error| DocumentError::Internal(error.into()))?
            .ok_or_else(|| DocumentError::NotFound(document_id.to_string()))?;

        let content_type = ContentType::from(file_type);
        let mime_type = content_type.mime_type().to_string();
        let key = build_cloud_storage_bucket_document_key(
            &document.owner,
            document_id,
            version.document_version_id,
        );
        let presigned_url = self
            .upload_url_service
            .put_document_storage_presigned_url(&key, sha, content_type)
            .await;

        match presigned_url {
            Ok(presigned_url) => Ok(FileVersionUpload {
                version,
                presigned_url,
                content_type: mime_type,
            }),
            Err(error) => {
                tracing::error!(?error, document_id, "unable to generate presigned url");
                self.remove_new_version(document_id, version).await;
                Err(DocumentError::Internal(anyhow!(
                    "unable to generate presigned url"
                )))
            }
        }
    }

    async fn remove_new_version(&self, document_id: &str, version: AddedFileVersion) {
        if version.created {
            self.remove_file_version(document_id, version.document_version_id)
                .await;
        }
    }

    pub(super) async fn remove_file_version(&self, document_id: &str, document_version_id: i64) {
        let _ = self
            .repo
            .remove_document_instance(document_id, document_version_id)
            .await
            .inspect_err(|error| {
                tracing::error!(
                    ?error,
                    document_id,
                    document_version_id,
                    "unable to delete document version"
                );
            });
    }
}
