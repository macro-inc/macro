//! Read known document metadata through a view receipt rather than discovery.

use super::*;
use crate::domain::models::{COMPLETED_STATUS_OPTION_ID, ViewedDocumentMetadata};
use crate::domain::ports::metadata::{DocumentMetadataService, TaskStatusPort};

impl<
    R: DocumentRepo,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort + TaskStatusPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
    S: DocumentSyncPort,
> DocumentMetadataService for DocumentServiceImpl<R, U, T, C, Eam, F, B, S>
{
    #[tracing::instrument(err, skip(self, receipt))]
    async fn viewed_metadata(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Option<ViewedDocumentMetadata>, DocumentError> {
        if receipt.entity().entity_type != EntityType::Document {
            return Err(DocumentError::BadRequest(
                "Expected a document receipt".into(),
            ));
        }
        let EntityAccessAuth::Authenticated(user) = receipt.auth() else {
            return Err(DocumentError::Unauthorized);
        };
        let id = &receipt.entity().entity_id;
        let document = match self.repo.get_document_metadata(id).await {
            Ok(document) => document,
            Err(error) => match map_basic_document_error(id, error.into()) {
                DocumentError::NotFound(_) => return Ok(None),
                error => return Err(error),
            },
        };
        if document.deleted_at.is_some() {
            return Ok(None);
        }
        let view = self
            .repo
            .get_document_view_metadata(id, user.as_ref())
            .await
            .map_err(|error| DocumentError::Internal(error.into()))?;
        let is_completed = if document.sub_type == Some(DocumentSubType::Task) {
            self.task_properties_service
                .task_status(&receipt)
                .await?
                .is_some_and(|options| options.contains(&COMPLETED_STATUS_OPTION_ID))
        } else {
            false
        };
        Ok(Some(ViewedDocumentMetadata {
            document,
            view,
            is_completed,
        }))
    }
}
