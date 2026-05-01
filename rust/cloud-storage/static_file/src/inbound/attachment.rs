//! [`AttachmentService`] implementation for static files.

use std::sync::Arc;

use attachment::{
    AttachmentContent, AttachmentError, AttachmentPart, AttachmentService, Attachments,
    ResolutionError, image::ImageData,
};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use non_empty::NonEmpty;

use crate::domain::ports::StaticFileRepo;

/// Resolves [`EntityType::StaticFile`] references into [`Attachments`].
pub struct StaticFileAttachmentService<R> {
    repo: Arc<R>,
}

impl<R> StaticFileAttachmentService<R> {
    /// Create a new static file attachment service.
    pub fn new(repo: Arc<R>) -> Self {
        Self { repo }
    }
}

impl<R: StaticFileRepo> AttachmentService for StaticFileAttachmentService<R> {
    #[tracing::instrument(skip_all)]
    async fn resolve_attachments<'a>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&'a Entity<'a>]>,
    ) -> Attachments<'a> {
        let results = join_all(ids.iter().map(|entity| async move {
            self.resolve_one(entity).await.map_err(|error| {
                ResolutionError::new(
                    entity
                        .entity_type
                        .with_entity_string(entity.entity_id.to_string()),
                    error,
                )
            })
        }))
        .await;

        Attachments::new(NonEmpty::new(results).expect("ids was non-empty"))
    }
}

impl<R: StaticFileRepo> StaticFileAttachmentService<R> {
    #[tracing::instrument(skip(self), err)]
    async fn resolve_one<'a>(
        &self,
        entity: &'a Entity<'a>,
    ) -> Result<AttachmentContent<'a>, AttachmentError> {
        if entity.entity_type != EntityType::StaticFile {
            return Err(AttachmentError::RoutingError(
                "StaticFileAttachmentService".to_string(),
                entity.entity_type,
            ));
        }

        let file_id = &*entity.entity_id;

        let content_type = self
            .repo
            .content_type(file_id)
            .await
            .map_err(AttachmentError::Internal)?;

        let is_image = content_type.type_() == mime::IMAGE;
        let is_text = content_type.type_() == mime::TEXT;

        if !is_image && !is_text {
            return Err(AttachmentError::UnsupportedFileType(
                content_type.to_string(),
            ));
        }

        let bytes = self
            .repo
            .read(file_id)
            .await
            .map_err(AttachmentError::Internal)?;

        let part = if is_image {
            AttachmentPart::Image(
                ImageData::try_from_bytes(bytes).map_err(AttachmentError::Internal)?,
            )
        } else {
            let text = String::from_utf8(bytes).map_err(|e| {
                AttachmentError::Internal(anyhow::anyhow!(
                    "static file content is not valid UTF-8: {e}"
                ))
            })?;
            AttachmentPart::Content(text)
        };

        Ok(AttachmentContent {
            reference: entity.clone(),
            name: None,
            content: NonEmpty::one(part),
        })
    }
}
