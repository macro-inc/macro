//! CreateDocument tool for reading document content.

use std::str::FromStr;

use crate::domain::create::{
    DocumentCreator, MarkdownSubtype, MarkdownText, MarkdownTextContent, NewDocument,
    NewDocumentMetadata, NonMarkdownFileType, TextFile, TextFileContent,
};
use crate::domain::ports::DocumentService;
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use anyhow::Context;
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DocumentToolContext;

/// The read content response
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentResponse {
    /// The id of the document
    pub document_id: uuid::Uuid,
}

#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(title = "CreateDocument", description = "Create a plaintext document.")]
pub struct CreateDocument {
    #[schemars(description = "The name of the document without the file extension")]
    pub document_name: String,

    #[schemars(description = "The string content of the document you are creating.")]
    pub file_content: String,

    #[schemars(description = "The extension of the plaintext file you are creating.")]
    pub file_extension: String,

    #[schemars(description = "Whether this document is a task. Only applies to md documents.")]
    #[serde(default)]
    pub is_task: bool,
}

#[async_trait]
impl<DSvc, ESvc> AsyncTool<DocumentToolContext<DSvc, ESvc>> for CreateDocument
where
    DSvc: DocumentService,
    ESvc: EntityAccessService,
{
    type Output = CreateDocumentResponse;

    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Create content");

        let parsed_file_type =
            FileType::from_str(&self.file_extension).map_err(|e| ToolCallError {
                description: format!("invalid file extension {}", self.file_extension),
                internal_error: e.into(),
            })?;
        let user_id: MacroUserIdStr<'static> = request_context.user_id.clone();

        if self.is_task && parsed_file_type != FileType::Md {
            return Err(ToolCallError {
                description: "tasks must be markdown documents".to_string(),
                internal_error: anyhow::anyhow!(
                    "task requested with file type {parsed_file_type:?}"
                ),
            });
        }

        let creator = DocumentCreator::new(
            service_context.service.as_ref(),
            service_context.lexical_client.as_ref(),
            service_context.sync_service_client.as_ref(),
        );

        let metadata = NewDocumentMetadata {
            id: None,
            document_name: self.document_name.clone(),
            project_id: None,
            email_attachment_id: None,
            created_at: None,
            skip_history: false,
        };

        let response = if parsed_file_type == FileType::Md {
            let document = NewDocument::<MarkdownText>::new(
                metadata,
                MarkdownTextContent {
                    markdown: self.file_content.clone(),
                    subtype: if self.is_task {
                        MarkdownSubtype::Task {
                            property_values: None,
                            share_with_team: true,
                        }
                    } else {
                        MarkdownSubtype::Note
                    },
                },
            );
            creator
                .create_markdown_text(user_id.clone(), document)
                .await
                .map(|document| document.into_response())
        } else {
            let file_type =
                NonMarkdownFileType::new(parsed_file_type).map_err(|e| ToolCallError {
                    description: "failed to create document".to_string(),
                    internal_error: e.into(),
                })?;
            let document = NewDocument::<TextFile>::new(
                metadata,
                TextFileContent {
                    file_type,
                    text: self.file_content.clone(),
                },
            );
            creator
                .create_text_file(user_id.clone(), document)
                .await
                .map(|document| document.into_response())
        }
        .map_err(|e| ToolCallError {
            description: "failed to create document".to_string(),
            internal_error: e.into(),
        })?;
        tracing::trace!("created document");

        let document_id_str = response
            .document_response
            .document_metadata
            .document_id
            .to_string();

        let document_id = document_id_str
            .parse()
            .context("expected valid uuid")
            .map_err(|e| ToolCallError {
                internal_error: e,
                description: format!("invalid document id was output {}", document_id_str),
            })?;

        tracing::info!("got to end");
        Ok(CreateDocumentResponse { document_id })
    }
}
