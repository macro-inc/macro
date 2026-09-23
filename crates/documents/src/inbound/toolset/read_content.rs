//! ReadContent tool for reading document content.

use ai_toolset::{ToolAnnotated, ToolAnnotations};
use std::str::FromStr;

use crate::domain::{
    comments::DocumentDiscussion,
    models::LocationQueryParams,
    ports::{DocumentService, create::DocumentCreationService, editing::EditingWorkerService},
    response::LocationResponseV3,
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EntityAccessReceipt, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use model::document::DocumentBasic;
use model_file_type::{FileAssociation, FileType};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::DocumentToolContext;

/// A single node of a markdown document as seen by the AI.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MarkdownNode {
    /// A textual content node (paragraph, heading, list, code block, etc.).
    #[serde(rename_all = "camelCase")]
    Generic {
        /// The node id
        node_id: String,
        /// Human readable content
        content: String,
        /// The style on the node, h1, paragraph, code, etc.
        tag: String,
    },
    /// An image hosted at a publicly fetchable URL. Fetch the URL to view it.
    StaticImage {
        /// URL the image can be fetched from.
        url: String,
    },
    /// An image stored in DSS. Pass this id to the read tool to view the image.
    DssImage {
        /// The DSS id of the image. Use the read tool with this id to read it.
        id: String,
    },
}

impl From<lexical_client::types::NewMdNode> for MarkdownNode {
    fn from(value: lexical_client::types::NewMdNode) -> Self {
        use lexical_client::types::NewMdNode;
        match value {
            NewMdNode::Generic(node) => MarkdownNode::Generic {
                node_id: node.node_id,
                content: node.content,
                tag: node.tag,
            },
            NewMdNode::StaticImage { url } => MarkdownNode::StaticImage { url },
            NewMdNode::DssImage { id } => MarkdownNode::DssImage { id },
        }
    }
}

/// The content of the document
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Content {
    /// Simple text content
    Text(String),
    /// All nodes of the markdown file
    Markdown(Vec<MarkdownNode>),
    /// The file is binary or too large to return inline. Fetch the URL to download it.
    #[serde(rename_all = "camelCase")]
    Download {
        /// Short-lived URL the raw file can be downloaded from.
        url: String,
    },
}

/// Files of an unsupported or unknown type are returned inline only when they
/// are UTF-8 text no larger than this; anything else is returned as a download URL.
const MAX_INLINE_TEXT_BYTES: usize = 512 * 1024;

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadContentResponse {
    /// The content of the document
    pub content: Content,
    /// The comment threads on the document, oldest first: inline comments
    /// with the text they are on, and Discussion comments on the whole
    /// document. Each thread lists its first comment followed by the replies.
    pub comments: Vec<DocumentDiscussion>,
}

#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadContent",
    description = "Retrieve a document's content and its comment threads, including inline comments with the text they are on, Discussion comments, replies and resolved state."
)]
pub struct ReadContent {
    #[schemars(description = "The id of the document you want to retrieve content for.")]
    pub document_id: Uuid,
}

impl ToolAnnotated for ReadContent {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read document");
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for ReadContent
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = ReadContentResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, document_id=?self.document_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Read metadata");

        // System skills are static, code-defined content with well-known ids
        // rather than documents; serve them before any document lookup or
        // access check (they are visible to every user).
        if let Some(skill) = system_skills::system_skill(self.document_id) {
            return Ok(ReadContentResponse {
                content: Content::Text(skill.render_content()),
                comments: Vec::new(),
            });
        }

        // Get EntityAccessReceipt
        let entity_access_receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt(
                &request_context.user_id,
                None,
                &self.document_id.to_string(),
                EntityType::Document,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the entity access receipt".to_string(),
                internal_error: e.into(),
            })?;

        // SAFETY: This is allowed because we have the entity_access_receipt call right above to
        // ensure the user has access.
        let document_context = service_context
            .service
            .internal_get_basic_document(&self.document_id.to_string())
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the document context".to_string(),
                internal_error: e.into(),
            })?;

        let file_type = document_context
            .file_type
            .as_deref()
            .and_then(|file_type| FileType::from_str(file_type).ok());

        let content: Content = if file_type == Some(FileType::Spreadsheet) {
            let result = service_context
                .spreadsheet
                .read(
                    entity_access_receipt.clone(),
                    &request_context.user_id,
                    service_context.actor.into_storage_id().as_ref(),
                    crate::domain::spreadsheet::SpreadsheetRequest::Read {
                        sheet_id: None,
                        ranges: None,
                        include_styles: None,
                    },
                )
                .await
                .map_err(|e| ToolCallError {
                    description: e.to_string(),
                    internal_error: e,
                })?;
            Content::Text(serde_json::to_string(&result).map_err(|e| ToolCallError {
                description: "unable to serialize spreadsheet overview".to_string(),
                internal_error: e.into(),
            })?)
        } else {
            match file_type.map(|file_type| file_type.macro_app_path()) {
                Some(FileAssociation::Pdf(_)) | Some(FileAssociation::Write(_)) => Content::Text(
                    service_context
                        .service
                        .get_document_text(entity_access_receipt.clone())
                        .await
                        .map_err(|e| ToolCallError {
                            description: "unable to get document text".to_string(),
                            internal_error: e.into(),
                        })?,
                ),
                Some(FileAssociation::Md(_)) => Content::Markdown(
                    service_context
                        .lexical_client
                        .parse_cognition_v2(&self.document_id.to_string())
                        .await
                        .map_err(|e| ToolCallError {
                            description: "unable to parse markdown".to_string(),
                            internal_error: e,
                        })?
                        .data
                        .into_iter()
                        .map(|i| i.into())
                        .collect(),
                ),
                Some(FileAssociation::Code(_)) | Some(FileAssociation::Document(_)) => {
                    Content::Text(
                        get_document_content_from_location(
                            service_context.clone(),
                            &document_context,
                            entity_access_receipt.clone(),
                        )
                        .await
                        .map_err(|e| ToolCallError {
                            description: "unable to get document content using location"
                                .to_string(),
                            internal_error: e,
                        })?,
                    )
                }
                _ => get_document_inline_text_or_download(
                    service_context.clone(),
                    &document_context,
                    entity_access_receipt.clone(),
                )
                .await
                .map_err(|e| ToolCallError {
                    description: "unable to download document".to_string(),
                    internal_error: e,
                })?,
            }
        };

        let comments = service_context
            .comments
            .discussions(entity_access_receipt)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get document comments".to_string(),
                internal_error: e.into(),
            })?;

        Ok(ReadContentResponse { content, comments })
    }
}

/// Gets the presigned download url for a document stored as a single file
async fn get_document_presigned_url<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
>(
    service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
    document_context: &DocumentBasic,
    entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
) -> anyhow::Result<String> {
    let location = service_context
        .service
        .get_document_location(
            document_context,
            entity_access_receipt,
            LocationQueryParams {
                get_converted_docx_url: Some(true),
                document_version_id: None,
            },
        )
        .await?;

    match location {
        LocationResponseV3::PresignedUrl {
            presigned_url,
            metadata: _metadata,
            content: _content,
        } => Ok(presigned_url),
        // This should only be called with single-file documents which result in 1 presigned url
        _ => unreachable!(),
    }
}

/// Gets the document content from location
#[tracing::instrument(skip(service_context), err)]
async fn get_document_content_from_location<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
>(
    service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
    document_context: &DocumentBasic,
    entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
) -> anyhow::Result<String> {
    let presigned_url =
        get_document_presigned_url(service_context, document_context, entity_access_receipt)
            .await?;

    // Download the file and convert to UTF8
    let response = reqwest::get(&presigned_url).await?;

    if !response.status().is_success() {
        anyhow::bail!("Failed to download document: HTTP {}", response.status());
    }

    let bytes = response.bytes().await?;
    let content = String::from_utf8(bytes.to_vec())
        .map_err(|e| anyhow::anyhow!("Document content is not valid UTF-8: {e}"))?;

    Ok(content)
}

/// Reads a document of an unknown or unsupported file type: small UTF-8 files are
/// returned as text, and everything else as a url the caller can download it from.
#[tracing::instrument(skip(service_context), err)]
async fn get_document_inline_text_or_download<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
>(
    service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
    document_context: &DocumentBasic,
    entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
) -> anyhow::Result<Content> {
    let presigned_url =
        get_document_presigned_url(service_context, document_context, entity_access_receipt)
            .await?;

    let mut response = reqwest::get(&presigned_url).await?;

    if !response.status().is_success() {
        anyhow::bail!("Failed to download document: HTTP {}", response.status());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_INLINE_TEXT_BYTES {
            return Ok(Content::Download { url: presigned_url });
        }
    }

    Ok(inline_text_or_download(bytes, presigned_url))
}

fn inline_text_or_download(bytes: Vec<u8>, url: String) -> Content {
    if bytes.len() > MAX_INLINE_TEXT_BYTES {
        return Content::Download { url };
    }
    match String::from_utf8(bytes) {
        Ok(text) => Content::Text(text),
        Err(_) => Content::Download { url },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://example.com/file";

    #[test]
    fn small_utf8_file_is_returned_as_text() {
        let content = inline_text_or_download(b"{\"traceEvents\":[]}".to_vec(), URL.to_string());
        assert!(matches!(content, Content::Text(text) if text == "{\"traceEvents\":[]}"));
    }

    #[test]
    fn binary_file_is_returned_as_download_url() {
        let content = inline_text_or_download(vec![0x1f, 0x8b, 0x08, 0xff], URL.to_string());
        assert!(matches!(content, Content::Download { url } if url == URL));
    }

    #[test]
    fn oversized_text_file_is_returned_as_download_url() {
        let content =
            inline_text_or_download(vec![b'a'; MAX_INLINE_TEXT_BYTES + 1], URL.to_string());
        assert!(matches!(content, Content::Download { url } if url == URL));
    }
}
