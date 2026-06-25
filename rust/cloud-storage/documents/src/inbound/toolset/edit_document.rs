//! EditDocument tool — thin wrapper over [`EditingWorkerPort`].

use crate::domain::ports::{
    DocumentService,
    create::DocumentCreationService,
    editing::EditingWorkerService,
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DocumentToolContext;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "EditDocument",
    description = "Apply AI-driven edits to a Macro document in place. Use this when the user wants to make changes to the content of an existing document — rewriting sections, inserting new content, applying formatting, or restructuring. Returns the number of edits applied."
)]
pub struct EditDocument {
    #[schemars(description = "The ID of the document to edit.")]
    pub document_id: String,
    #[schemars(
        description = "Natural language instructions describing the changes to make to the document."
    )]
    pub instructions: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct EditDocumentResponse {
    /// Number of individual edit operations applied to the document.
    pub edits_applied: usize,
    pub usage: Option<EditUsage>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct EditUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for EditDocument
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = EditDocumentResponse;

    #[tracing::instrument(skip_all, fields(document_id = %self.document_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user_token = ctx.user_token.as_deref().ok_or_else(|| {
            let e = anyhow::anyhow!("user_token not available on DocumentToolContext");
            ToolCallError { description: "editing worker requires a user token".to_string(), internal_error: e }
        })?;
        let result = ctx
            .editing
            .edit(&self.document_id, user_token, &self.instructions)
            .await
            .map_err(|e| ToolCallError {
                description: e.to_string(),
                internal_error: e,
            })?;

        Ok(EditDocumentResponse {
            edits_applied: result.edits_applied,
            usage: result.usage.map(|u| EditUsage {
                input_tokens: u.input_tokens,
                output_tokens: u.output_tokens,
            }),
        })
    }
}
