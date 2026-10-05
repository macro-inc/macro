//! Reads image references through the owning domains' attachment services.

use attachment::image::ImageData;
use attachment::{AttachmentError, AttachmentPart, AttachmentService};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use model_entity::EntityType;
use model_owner::CreationPrincipal;
use non_empty::NonEmpty;

use crate::domain::models::{ImageReference, ReadImageError, ReferenceImage};
use crate::domain::ports::ImageReferenceReader;

#[cfg(test)]
mod test;

/// Resolves document and static-file identifiers through inbound services.
///
/// The document service verifies caller access. Static-file identifiers carry
/// the existing CDN capability semantics; their service reads only its
/// configured storage. Arbitrary URLs never enter this adapter.
pub struct AttachmentImageReferenceReader<D, S> {
    documents: D,
    static_files: S,
}

impl<D, S> AttachmentImageReferenceReader<D, S> {
    /// Use already-composed document and static-file attachment services.
    pub fn new(documents: D, static_files: S) -> Self {
        Self {
            documents,
            static_files,
        }
    }
}

impl<D: AttachmentService, S: AttachmentService> ImageReferenceReader
    for AttachmentImageReferenceReader<D, S>
{
    #[tracing::instrument(skip_all, err)]
    async fn read_image(
        &self,
        principal: &CreationPrincipal,
        reference: &ImageReference,
    ) -> Result<ReferenceImage, ReadImageError> {
        let user = principal.user().ok_or(ReadImageError::Unauthorized)?;
        let entity = match reference {
            ImageReference::Document(id) => EntityType::Document.with_entity_string(id.to_string()),
            ImageReference::StaticFile(id) => {
                EntityType::StaticFile.with_entity_string(id.to_string())
            }
        };
        let entities = [&entity];
        let entities = NonEmpty::new(entities.as_slice()).expect("one reference");
        let resolved = match reference {
            ImageReference::Document(_) => {
                self.documents
                    .resolve_attachments(user.clone(), entities)
                    .await
            }
            ImageReference::StaticFile(_) => {
                self.static_files
                    .resolve_attachments(user.clone(), entities)
                    .await
            }
        };
        let mut attachments = resolved.into_parts().into_inner();
        if attachments.len() != 1 {
            return Err(ReadImageError::NotImage);
        }
        let content = attachments
            .pop()
            .expect("one resolved attachment")
            .map_err(|error| attachment_error(error.error))?;
        let mut parts = content.content.into_inner();
        if parts.len() != 1 {
            return Err(ReadImageError::NotImage);
        }
        let AttachmentPart::Image(ImageData::Base64(image)) =
            parts.pop().expect("one attachment part")
        else {
            return Err(ReadImageError::NotImage);
        };
        let bytes = STANDARD
            .decode(image.base64_data())
            .map_err(|error| ReadImageError::Internal(rootcause::report!(error).into()))?;
        Ok(ReferenceImage {
            bytes,
            mime_type: "image/webp".to_owned(),
        })
    }
}

fn attachment_error(error: AttachmentError) -> ReadImageError {
    match error {
        AttachmentError::PermissionDenied(_) => ReadImageError::Unauthorized,
        AttachmentError::UnknownFileType
        | AttachmentError::UnsupportedFileType(_)
        | AttachmentError::NoContent => ReadImageError::NotImage,
        error => ReadImageError::Internal(rootcause::report!(error).into()),
    }
}
