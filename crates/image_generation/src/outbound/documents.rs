//! Saves images through the documents domain's inbound upload port.
use crate::domain::{
    models::{NewImageDocument, SaveImageError},
    ports::ImageDocumentStore,
};
use documents::domain::{
    create::upload::NewFileUpload, models::DocumentError, ports::create::DocumentUploadService,
};
use model_owner::CreationPrincipal;
use uuid::Uuid;

/// Adapter to the existing document upload lifecycle.
pub struct DocumentsImageStore<Svc> {
    service: Svc,
}

impl<Svc> DocumentsImageStore<Svc> {
    /// Use an already-composed document upload service.
    pub fn new(service: Svc) -> Self {
        Self { service }
    }
}

impl<Svc: DocumentUploadService> ImageDocumentStore for DocumentsImageStore<Svc> {
    #[tracing::instrument(skip_all, err)]
    async fn save_image(
        &self,
        principal: &CreationPrincipal,
        image: NewImageDocument,
    ) -> Result<Uuid, SaveImageError> {
        let created = self
            .service
            .upload_file(
                principal,
                NewFileUpload {
                    file_name: image.file_name,
                    bytes: image.bytes,
                    project: image.project,
                },
            )
            .await
            .map_err(|error| match error {
                DocumentError::BadRequest(message) => SaveImageError::BadRequest(message),
                DocumentError::NameTooLong { max } => SaveImageError::NameTooLong { max },
                DocumentError::Unauthorized => SaveImageError::Unauthorized,
                error => SaveImageError::Internal(rootcause::report!(error).into()),
            })?;
        created
            .document_id()
            .parse::<Uuid>()
            .map_err(|error| SaveImageError::Internal(rootcause::report!(error).into()))
    }
}

#[cfg(test)]
mod test;
