//! Thin adapters mint typed access receipts and enter the document domain.
use super::DocumentToolContext;
use crate::domain::{
    code_editing::{DocumentState, DocumentUpdate},
    ports::{DocumentService, create::DocumentCreationService, editing::EditingWorkerService},
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EditAccessLevel, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

fn failure(error: impl Into<anyhow::Error>) -> ToolCallError {
    let internal_error = error.into();
    ToolCallError {
        description: internal_error.to_string(),
        internal_error,
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ReadDocumentState",
    description = "Read complete Macro markdown state, XML, durable node IDs and opaque revision. In code use sdk.documents.open({documentId}); explore sdk.help(\"documents\")."
)]
pub struct ReadDocumentState {
    /// Macro markdown document ID.
    pub document_id: String,
}
impl ToolAnnotated for ReadDocumentState {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read document state");
}
#[async_trait]
impl<D, A, W> AsyncTool<DocumentToolContext<D, A, W>> for ReadDocumentState
where
    D: DocumentService + DocumentCreationService,
    A: EntityAccessService,
    W: EditingWorkerService,
{
    type Output = DocumentState;
    async fn call(
        &self,
        ctx: ServiceContext<DocumentToolContext<D, A, W>>,
        req: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = ctx
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &req.user_id,
                None,
                &self.document_id,
                EntityType::Document,
            )
            .await
            .map_err(failure)?;
        let service = ctx.code_editing();
        let actor = ctx.actor.into_storage_id();
        tokio::select! {
            biased;
            _ = req.cancel.cancelled() => Err(failure(anyhow::anyhow!("Document operation cancelled. Read before retrying an edit."))),
            result = service.read(receipt, &req.user_id, actor.as_ref()) => result.map_err(failure),
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(
    title = "ApplyDocumentOperations",
    description = "Apply up to 200 shared DocumentEditor operations atomically against a read revision. In code use doc.editor methods then await doc.save(). Stale revisions or invalid operations change nothing. Never blindly retry a write."
)]
pub struct ApplyDocumentOperations {
    /// Macro markdown document ID.
    pub document_id: String,
    /// Revision obtained by ReadDocumentState.
    pub expected_revision: String,
    /// Use DocumentEditor to construct operations; see sdk.help("documents.editor").
    pub operations: Vec<Value>,
}
impl ToolAnnotated for ApplyDocumentOperations {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Apply document operations");
}
#[async_trait]
impl<D, A, W> AsyncTool<DocumentToolContext<D, A, W>> for ApplyDocumentOperations
where
    D: DocumentService + DocumentCreationService,
    A: EntityAccessService,
    W: EditingWorkerService,
{
    type Output = DocumentUpdate;
    async fn call(
        &self,
        ctx: ServiceContext<DocumentToolContext<D, A, W>>,
        req: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = ctx
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &req.user_id,
                None,
                &self.document_id,
                EntityType::Document,
            )
            .await
            .map_err(failure)?;
        let service = ctx.code_editing();
        let actor = ctx.actor.into_storage_id();
        tokio::select! {
            biased;
            _ = req.cancel.cancelled() => Err(failure(anyhow::anyhow!("Document operation cancelled. Read before retrying an edit."))),
            result = service.apply(receipt, &req.user_id, actor.as_ref(), self.expected_revision.clone(), self.operations.clone()) => result.map_err(failure),
        }
    }
}
