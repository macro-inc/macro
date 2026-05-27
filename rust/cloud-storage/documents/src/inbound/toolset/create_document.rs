//! CreateDocument tool for reading document content.

use std::str::FromStr;

use crate::domain::create::{NewDocumentMetadata, NewPlainTextDocument};
use crate::domain::models::DocumentError;
use crate::domain::ports::DocumentService;
use crate::domain::ports::create::DocumentCreationService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use anyhow::Context;
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DocumentToolContext;

fn failed_to_create_document(error: DocumentError) -> ToolCallError {
    let description = match &error {
        DocumentError::BadRequest(message) => message.clone(),
        _ => "failed to create document".to_string(),
    };

    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

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
    DSvc: DocumentService + DocumentCreationService,
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

        let document =
            NewPlainTextDocument::builder(NewDocumentMetadata::new(self.document_name.clone()))
                .file_type(parsed_file_type)
                .text(self.file_content.clone())
                .task_flag(self.is_task)
                .build()
                .map_err(failed_to_create_document)?;

        let response = service_context
            .creator
            .create_plain_text(user_id, document)
            .await
            .map(|document| document.into_response())
            .map_err(failed_to_create_document)?;

        tracing::trace!("created document");

        let document_id_str = response
            .document_response
            .document_metadata
            .metadata
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
