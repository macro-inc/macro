//! Markdown document resolution via the lexical client.

use ai::types::ImageData;
use attachment::{
    AttachmentContent, AttachmentError, AttachmentPart, AttachmentReference, ResolutionError,
};
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
) -> Result<AttachmentContent, AttachmentError> {
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
        reference: AttachmentReference::DssFile { id: id.to_string() },
        name: Some(document.document_name.clone()),
        content,
    })
}

async fn resolve_dss_image<DSvc: DocumentService, ESvc: EntityAccessService>(
    svc: &DocumentAttachmentService<DSvc, ESvc>,
    user_id: &MacroUserIdStr<'_>,
    image_id: &str,
) -> AttachmentPart {
    let reference = AttachmentReference::DssFile {
        id: image_id.to_string(),
    };
    let result = try_resolve_dss_image(svc, user_id, image_id)
        .await
        .map(|data| AttachmentContent {
            reference,
            name: None,
            content: NonEmpty::new(vec![AttachmentPart::Image(data)]).expect("single element"),
        })
        .map_err(|error| ResolutionError::new(image_id.to_string(), error));
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

async fn resolve_static_image(url: &str) -> AttachmentPart {
    let reference = AttachmentReference::SfsImage {
        url: url.to_string(),
    };
    let result = try_resolve_static_image(url)
        .await
        .map(|data| AttachmentContent {
            reference,
            name: None,
            content: NonEmpty::new(vec![AttachmentPart::Image(data)]).expect("single element"),
        })
        .map_err(|error| ResolutionError::new(url.to_string(), error));
    AttachmentPart::Child(Box::new(result))
}

async fn try_resolve_static_image(url: &str) -> Result<ImageData, AttachmentError> {
    let bytes = super::service::fetch_url_bytes(url).await?;
    ImageData::try_from_bytes(bytes).map_err(AttachmentError::Internal)
}
