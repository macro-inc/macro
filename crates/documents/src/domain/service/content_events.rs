//! Resolve document metadata before publishing content-change events.

use super::*;
use crate::domain::events::{DocumentContentUploadedMetadata, DocumentSyncContentUpdatedMetadata};

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
    S: DocumentSyncPort,
> DocumentContentEventService for DocumentServiceImpl<R, U, T, C, Eam, F, B, S>
{
    #[tracing::instrument(err, skip(self))]
    async fn publish_content_uploaded(
        &self,
        document_id: &str,
        file_type: FileType,
        document_version_id: Option<String>,
    ) -> Result<(), DocumentError> {
        let document = self
            .repo
            .get_basic_document(document_id)
            .await
            .map_err(|error| map_basic_document_error(document_id, error.into()))?;

        self.macro_event_broker
            .send_event(&DocumentMacroEvent::content_uploaded(
                document_id,
                DocumentContentUploadedMetadata {
                    document_id: document_id.to_string(),
                    owner: document.owner,
                    file_type,
                    document_version_id,
                },
            ))
            .map(|_| ())
            .map_err(|error| DocumentError::Internal(error.into()))
    }

    #[tracing::instrument(err, skip(self))]
    async fn publish_sync_content_updated(
        &self,
        document_id: &str,
        editors: Vec<crate::domain::events::DocumentSyncEditor>,
    ) -> Result<(), DocumentError> {
        let document = self
            .repo
            .get_basic_document(document_id)
            .await
            .map_err(|error| map_basic_document_error(document_id, error.into()))?;
        let file_type = document
            .file_type
            .as_deref()
            .and_then(|value| FileType::from_str(value).ok())
            .ok_or_else(|| DocumentError::BadRequest("Unknown document file type".to_string()))?;

        let mut metadata = DocumentSyncContentUpdatedMetadata::from_extract(
            document_id.to_string(),
            file_type,
            None,
            None,
            None,
        );
        metadata.editors = editors;
        self.macro_event_broker
            .send_event(&DocumentMacroEvent::sync_content_updated(
                document_id,
                metadata,
            ))
            .map(|_| ())
            .map_err(|error| DocumentError::Internal(error.into()))
    }
}
