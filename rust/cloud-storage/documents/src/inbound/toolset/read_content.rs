//! ReadContent tool for reading document content.

use std::str::FromStr;

use crate::domain::{
    models::{CommentThread, LocationQueryParams},
    ports::{DocumentService, create::DocumentCreationService},
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
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadContentResponse {
    /// The content of the document
    pub content: Content,
    /// Any comments on the document
    pub comments: Vec<CommentThread>,
}

#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(title = "ReadContent", description = "Retrieve a documents content")]
pub struct ReadContent {
    #[schemars(description = "The id of the document you want to retrieve content for.")]
    pub document_id: Uuid,
}

#[async_trait]
impl<DSvc, ESvc> AsyncTool<DocumentToolContext<DSvc, ESvc>> for ReadContent
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
{
    type Output = ReadContentResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, document_id=?self.document_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Read metadata");

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

        // Based on the file type we need to handle how we get the document differently
        let file_type: FileType = if let Some(file_type) = document_context.file_type.as_ref() {
            FileType::from_str(file_type).map_err(|e| ToolCallError {
                description: format!("unsupported file type {file_type}"),
                internal_error: e.into(),
            })?
        } else {
            return Err(ToolCallError {
                description: "cannot get read content for unknown file type".to_string(),
                internal_error: anyhow::anyhow!("cannot get read content for unknown file type"),
            });
        };

        let content: Content = match file_type.macro_app_path() {
            FileAssociation::Pdf(_) | FileAssociation::Write(_) => Content::Text(
                service_context
                    .service
                    .get_document_text(entity_access_receipt.clone())
                    .await
                    .map_err(|e| ToolCallError {
                        description: "unable to get document text".to_string(),
                        internal_error: e.into(),
                    })?,
            ),
            FileAssociation::Md(_) => Content::Markdown(
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
            FileAssociation::Code(_) | FileAssociation::Document(_) => Content::Text(
                get_document_content_from_location(
                    service_context.clone(),
                    &document_context,
                    entity_access_receipt.clone(),
                )
                .await
                .map_err(|e| ToolCallError {
                    description: "unable to get document content using location".to_string(),
                    internal_error: e,
                })?,
            ),
            _ => {
                return Err(ToolCallError {
                    description: format!("unsupported file type {file_type}"),
                    internal_error: anyhow::anyhow!("unsupported file type"),
                });
            }
        };

        let comments = service_context
            .service
            .get_document_comments(entity_access_receipt)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get document comments".to_string(),
                internal_error: e.into(),
            })?;

        Ok(ReadContentResponse { content, comments })
    }
}

/// Gets the document content from location
#[tracing::instrument(skip(service_context), err)]
async fn get_document_content_from_location<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
>(
    service_context: ServiceContext<DocumentToolContext<DSvc, ESvc>>,
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

    let presigned_url = match location {
        LocationResponseV3::PresignedUrl {
            presigned_url,
            metadata: _metadata,
            content: _content,
        } => presigned_url,
        // This should only be called with text documents which result in 1 presigned url
        _ => unreachable!(),
    };

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
