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
    description = "Apply AI-driven edits to a Macro document in place -- rewriting, inserting, formatting, or restructuring. If the response contains a `clarification` field, invoke again with the requested info appended to `instructions`. To insert mention(s), include each person's userId and email. To insert document-card(s), include each document's documentId and documentName."
)]
pub struct EditDocument {
    #[schemars(description = "The ID of the document to edit.")]
    pub document_id: String,
    #[schemars(
        description = "Natural language instructions. For mention(s), include userId and email per person. For document-card(s), include documentId and documentName per document. You may need to look these up."
    )]
    pub instructions: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct EditDocumentResponse {
    /// A short outcome for the model -- whether the edit was applied or
    /// interrupted -- never the underlying list of edit operations.
    pub summary: String,
    /// If present, invoke this tool again with this information appended to `instructions`.
    pub clarification: Option<String>,
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
        request_context: RequestContext,
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

        // The worker runs several models on the caller's behalf; record each so
        // their tokens land on the usage ledger (attributed to this user).
        let entity = macro_uuid::string_to_uuid(&self.document_id).ok();
        for u in &result.usage {
            let cx = ai_usage::UsageContext::new(
                ai_usage::AiFeature::AiEditing,
                request_context.user_id.clone(),
            )
            .with_entity(entity);
            ctx.recorder.record(cx.into_event(
                u.model.clone(),
                u.input_tokens as u64,
                u.output_tokens as u64,
            ));
        }

        let summary = if result.clarification.is_some() {
            "Paused for clarification; no edits applied.".to_string()
        } else {
            format!("Applied {} edit(s) to the document.", result.edits_applied)
        };

        Ok(EditDocumentResponse {
            summary,
            clarification: result.clarification,
        })
    }
}
