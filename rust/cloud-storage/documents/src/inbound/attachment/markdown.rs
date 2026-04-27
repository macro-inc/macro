//! Markdown document resolution via the lexical client.

use attachment::image::ImageData;
use attachment::{AttachmentContent, AttachmentError, AttachmentPart, ResolutionError};
use entity_access::domain::ports::EntityAccessService;
use futures::future::join_all;
use lexical_client::types::NewMdNode;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::DocumentBasic;
use model_entity::EntityType;
use non_empty::NonEmpty;

use crate::domain::ports::DocumentService;

use super::service::DocumentAttachmentService;

/// Resolve a markdown document into an [`AttachmentContent`] with interleaved
/// text and image parts.
pub(super) async fn resolve_markdown<DSvc: DocumentService, ESvc: EntityAccessService>(
    svc: &DocumentAttachmentService<DSvc, ESvc>,
    user_id: &MacroUserIdStr<'_>,
    id: &str,
    document: &DocumentBasic,
) -> Result<AttachmentContent<'static>, AttachmentError> {
    let response = svc
        .lexical_client
        .parse_cognition_v2(id)
        .await
        .map_err(AttachmentError::Internal)?;

    let parts = join_all(response.data.into_iter().map(|node| async {
        match node {
            NewMdNode::Generic(n) => AttachmentPart::Content(n.content),
            NewMdNode::DssImage { id } => resolve_dss_image(svc, user_id, &id).await,
            NewMdNode::StaticImage { url } => resolve_static_image(&url).await,
        }
    }))
    .await;

    let content = NonEmpty::new(parts).map_err(|_| AttachmentError::NoContent)?;

    Ok(AttachmentContent {
        reference: EntityType::Document.with_entity_string(id.to_string()),
        name: Some(document.document_name.clone()),
        content,
    })
}

async fn resolve_dss_image<DSvc: DocumentService, ESvc: EntityAccessService>(
    svc: &DocumentAttachmentService<DSvc, ESvc>,
    user_id: &MacroUserIdStr<'_>,
    image_id: &str,
) -> AttachmentPart<'static> {
    let reference = EntityType::Document.with_entity_string(image_id.to_string());
    let result = match try_resolve_dss_image(svc, user_id, image_id).await {
        Ok(data) => Ok(AttachmentContent {
            reference,
            name: None,
            content: NonEmpty::one(AttachmentPart::Image(data)),
        }),
        Err(error) => Err(ResolutionError::new(reference, error)),
    };
    AttachmentPart::Child(Box::new(result))
}

async fn try_resolve_dss_image<DSvc: DocumentService, ESvc: EntityAccessService>(
    svc: &DocumentAttachmentService<DSvc, ESvc>,
    user_id: &MacroUserIdStr<'_>,
    image_id: &str,
) -> Result<ImageData, AttachmentError> {
    let receipt = svc
        .entity_access_service
        .generate_entity_access_receipt(user_id, None, image_id, EntityType::Document)
        .await
        .map_err(|e| AttachmentError::Internal(e.into()))?;

    let document = svc
        .document_service
        .internal_get_basic_document(image_id)
        .await
        .map_err(|e| AttachmentError::Internal(e.into()))?;

    svc.get_image_from_location(&document, receipt).await
}

async fn resolve_static_image(url: &str) -> AttachmentPart<'static> {
    let reference = EntityType::StaticFile.with_entity_string(url.to_string());
    let result = match try_resolve_static_image(url).await {
        Ok(data) => Ok(AttachmentContent {
            reference,
            name: None,
            content: NonEmpty::one(AttachmentPart::Image(data)),
        }),
        Err(error) => Err(ResolutionError::new(reference, error)),
    };
    AttachmentPart::Child(Box::new(result))
}

async fn try_resolve_static_image(url: &str) -> Result<ImageData, AttachmentError> {
    let bytes = super::service::fetch_url_bytes(url).await?;
    ImageData::try_from_bytes(bytes).map_err(AttachmentError::Internal)
}
