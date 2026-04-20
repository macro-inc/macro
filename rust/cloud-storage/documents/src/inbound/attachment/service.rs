//! [`AttachmentService`] implementation for documents.

use std::str::FromStr;
use std::sync::Arc;

use ai::types::ImageData;
use attachment::{
    AttachmentContent, AttachmentError, AttachmentPart, AttachmentReference, AttachmentService,
    Attachments, ResolutionError,
};
use entity_access::domain::{
    models::{EntityAccessReceipt, ViewAccessLevel},
    ports::EntityAccessService,
};
use futures::future::join_all;
use lexical_client::LexicalClient;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::DocumentBasic;
use model_entity::EntityType;
use model_file_type::{FileAssociation, FileType};
use non_empty::NonEmpty;

use crate::domain::{models::LocationQueryParams, ports::DocumentService};

use super::markdown;

/// Resolves document IDs into [`Attachments`].
pub struct DocumentAttachmentService<DSvc, ESvc> {
    pub(super) document_service: Arc<DSvc>,
    pub(super) entity_access_service: Arc<ESvc>,
    pub(super) lexical_client: Arc<LexicalClient>,
}

impl<DSvc, ESvc> DocumentAttachmentService<DSvc, ESvc> {
    /// Create a new document attachment service.
    pub fn new(
        document_service: Arc<DSvc>,
        entity_access_service: Arc<ESvc>,
        lexical_client: Arc<LexicalClient>,
    ) -> Self {
        Self {
            document_service,
            entity_access_service,
            lexical_client,
        }
    }
}

impl<DSvc: DocumentService, ESvc: EntityAccessService> AttachmentService
    for DocumentAttachmentService<DSvc, ESvc>
{
    #[tracing::instrument(skip_all)]
    async fn resolve_attachments(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&str]>,
    ) -> Attachments {
        let user_id = &user_id;
        let results = join_all(ids.iter().map(|id| async move {
            self.resolve_one(user_id, id)
                .await
                .map_err(|error| ResolutionError::new(id.to_string(), error))
        }))
        .await;

        Attachments::new(NonEmpty::new(results).expect("ids was non-empty"))
    }
}

impl<DSvc: DocumentService, ESvc: EntityAccessService> DocumentAttachmentService<DSvc, ESvc> {
    #[tracing::instrument(skip(self), err)]
    async fn resolve_one(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: &str,
    ) -> Result<AttachmentContent, AttachmentError> {
        let receipt = self
            .entity_access_service
            .generate_entity_access_receipt(user_id, None, id, EntityType::Document)
            .await
            .map_err(|e| AttachmentError::Internal(e.into()))?;

        let document = self
            .document_service
            .internal_get_basic_document(id)
            .await
            .map_err(|e| AttachmentError::Internal(e.into()))?;

        let file_type = document
            .file_type
            .as_ref()
            .ok_or(AttachmentError::UnknownFileType)
            .and_then(|ft| {
                FileType::from_str(ft).map_err(|_| AttachmentError::UnsupportedFileType(ft.clone()))
            })?;

        let parts = match file_type.macro_app_path() {
            FileAssociation::Pdf(_) | FileAssociation::Write(_) => {
                let text = self
                    .document_service
                    .get_document_text(receipt)
                    .await
                    .map_err(|e| AttachmentError::Internal(e.into()))?;
                vec![AttachmentPart::Content(text)]
            }
            FileAssociation::Md(_) => {
                return markdown::resolve_markdown(self, user_id, id, &document).await;
            }
            FileAssociation::Code(_) | FileAssociation::Document(_) => {
                let text = self.get_text_from_location(&document, receipt).await?;
                vec![AttachmentPart::Content(text)]
            }
            FileAssociation::Image(_) => {
                let data = self.get_image_from_location(&document, receipt).await?;
                vec![AttachmentPart::Image(data)]
            }
            _ => return Err(AttachmentError::UnsupportedFileType(file_type.to_string())),
        };

        Ok(AttachmentContent {
            reference: AttachmentReference::DssFile { id: id.to_string() },
            name: Some(document.document_name.clone()),
            content: NonEmpty::new(parts).expect("parts has one element"),
        })
    }

    pub(super) async fn get_text_from_location(
        &self,
        document: &DocumentBasic,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, AttachmentError> {
        let url = self.presigned_url_for(document, receipt).await?;
        let bytes = fetch_url_bytes(&url).await?;
        String::from_utf8(bytes).map_err(|e| {
            AttachmentError::Internal(anyhow::anyhow!("document content is not valid UTF-8: {e}"))
        })
    }

    pub(super) async fn get_image_from_location(
        &self,
        document: &DocumentBasic,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<ImageData, AttachmentError> {
        let url = self.presigned_url_for(document, receipt).await?;
        let bytes = fetch_url_bytes(&url).await?;
        ImageData::try_from_bytes(bytes).map_err(AttachmentError::Internal)
    }

    pub(super) async fn presigned_url_for(
        &self,
        document: &DocumentBasic,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, AttachmentError> {
        let location = self
            .document_service
            .get_document_location(
                document,
                receipt,
                LocationQueryParams {
                    get_converted_docx_url: Some(true),
                    document_version_id: None,
                },
            )
            .await
            .map_err(|e| AttachmentError::Internal(e.into()))?;

        match location {
            model::document::response::LocationResponseV3::PresignedUrl {
                presigned_url, ..
            } => Ok(presigned_url),
            _ => Err(AttachmentError::Internal(anyhow::anyhow!(
                "unexpected location response for document"
            ))),
        }
    }
}

pub(super) async fn fetch_url_bytes(url: &str) -> Result<Vec<u8>, AttachmentError> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| AttachmentError::Internal(e.into()))?;
    if !response.status().is_success() {
        return Err(AttachmentError::Internal(anyhow::anyhow!(
            "failed to fetch {url}: HTTP {}",
            response.status()
        )));
    }
    response
        .bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| AttachmentError::Internal(e.into()))
}
