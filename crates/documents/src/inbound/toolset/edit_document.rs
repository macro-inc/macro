//! EditDocument tool — thin wrapper over [`EditingWorkerPort`].

use crate::domain::permission_token::encode_permission_token;
use crate::domain::ports::{
    DocumentService, create::DocumentCreationService, editing::EditingWorkerService,
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EditAccessLevel, EntityType},
    ports::EntityAccessService,
};
use model::document::{DocumentBasic, FileType};
use models_permissions::share_permission::access_level::AccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DocumentToolContext;

#[cfg(test)]
mod test;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "EditDocument",
    description = "Apply AI-driven edits to a Macro markdown document in place -- rewriting, inserting, formatting, or restructuring. Markdown documents only: these are authored in Macro's collaborative editor, and are the only documents whose content this tool can rewrite. Uploaded files -- PDFs, DOCX, spreadsheets, images, source files such as .py or .ts -- are readable but not editable, and are rejected. If the response contains a `clarification` field, invoke again with the requested info appended to `instructions`. To insert mention(s), include each person's userId and email. To insert document-card(s), include each document's documentId and documentName."
)]
pub struct EditDocument {
    #[schemars(
        description = "The ID of the markdown document to edit. If you are not certain the document is markdown, call ReadMetadata first and check that `fileType` is `md` -- passing an uploaded file here fails."
    )]
    pub document_id: String,
    #[schemars(
        description = "Natural language instructions. For mention(s), include userId and email per person. For document-card(s), include documentId and documentName per document. You may need to look these up."
    )]
    pub instructions: String,
}

/// The editing worker opens a sync-service session and blocks on the initial
/// Loro snapshot. Only markdown documents ever get a Loro doc, so anything else
/// waits out the worker's handshake timeout and surfaces as an opaque gateway
/// error. Reject those up front instead.
///
/// This gates on the file type rather than the document's current content
/// location on purpose. Markdown uploaded to S3 is initialized into sync-service
/// when its upload finalizes, so its location is legitimately `object_storage`
/// for the width of that window while the Loro doc is still being created. The
/// sync session tolerates that -- the server broadcasts the snapshot to sockets
/// already waiting once `/initialize` lands. Gating on location would reject an
/// edit that window is designed to serve; the file type does not move.
fn ensure_markdown(document: &DocumentBasic) -> Result<(), ToolCallError> {
    if document.try_file_type() == Some(FileType::Md) {
        return Ok(());
    }

    let file_type = document.file_type.as_deref().unwrap_or("unknown");
    Err(ToolCallError {
        description: format!(
            "this document cannot be edited: it is a `{file_type}` file, not a Macro markdown document. AI editing only works on markdown documents authored in Macro's collaborative editor -- uploaded files (PDFs, DOCX, images, source files, and so on) are readable but not editable. Report this back to the user rather than retrying."
        ),
        internal_error: anyhow::anyhow!("document file type {file_type} is not markdown"),
    })
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct EditDocumentResponse {
    /// A short outcome for the model -- whether the edit was applied or
    /// interrupted -- never the underlying list of edit operations.
    pub summary: String,
    /// If present, invoke this tool again with this information appended to `instructions`.
    pub clarification: Option<String>,
}

impl ToolAnnotated for EditDocument {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Edit document");
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
        ctx.entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &request_context.user_id,
                None,
                &self.document_id,
                EntityType::Document,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "you do not have edit access to this document".to_string(),
                internal_error: e.into(),
            })?;

        let document = ctx
            .service
            .internal_get_basic_document(&self.document_id)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to look up this document".to_string(),
                internal_error: e.into(),
            })?;

        ensure_markdown(&document)?;

        let document_token = encode_permission_token(
            Some(request_context.user_id.to_string()),
            self.document_id.clone(),
            AccessLevel::Edit,
            &ctx.document_permission_jwt_secret,
            Some(ctx.actor.into_storage_id().to_string()),
        )
        .map_err(|e| ToolCallError {
            description: "failed to mint document token".to_string(),
            internal_error: e.into(),
        })?;

        // Honor user cancellation: if the request is cancelled mid-edit, drop the
        // in-flight worker call (closing the HTTP connection so the worker aborts
        // its own LLM work) and surface a `cancelled` tool error -- matching how
        // the chat stream renders cancellation for tool calls that never returned.
        let result = tokio::select! {
            _ = request_context.cancel.cancelled() => {
                return Err(ToolCallError {
                    description: "cancelled".to_string(),
                    internal_error: anyhow::anyhow!("edit cancelled by user. document might be left in a partially edited state."),
                });
            }
            r = ctx.editing.edit(&self.document_id, &document_token, &self.instructions) => r,
        }
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
