//! ResolveDocumentComment tool for resolving and reopening document comment threads.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use messages::domain::models::ThreadPatch;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DocumentToolContext, comment_error};
use crate::domain::ports::{
    DocumentService, create::DocumentCreationService, editing::EditingWorkerService,
};

fn default_resolved() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ResolveDocumentComment",
    description = "Resolve or reopen a comment thread on a document on behalf of the user. Only use this when explicitly asked to resolve or reopen a comment. Thread ids come from the comments ReadContent returns."
)]
pub struct ResolveDocumentComment {
    #[schemars(description = "The id of the document the comment is on.")]
    pub document_id: Uuid,

    #[schemars(description = "The id of the inline or Discussion thread, from ReadContent.")]
    pub thread_id: Uuid,

    #[serde(default = "default_resolved")]
    #[schemars(
        description = "True to resolve the thread, false to reopen a resolved thread. Defaults to true."
    )]
    pub resolved: bool,
}

/// The thread's state after the change.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveDocumentCommentResponse {
    /// The document the thread is on.
    pub document_id: Uuid,
    /// The thread that was changed.
    pub thread_id: Uuid,
    /// Whether the thread is now resolved.
    pub resolved: bool,
}

impl ToolAnnotated for ResolveDocumentComment {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Resolve document comment");
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for ResolveDocumentComment
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = ResolveDocumentCommentResponse;

    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = service_context
            .require_comment_write(&request_context, self.document_id)
            .await?;

        let state = service_context
            .messages
            .patch_thread(
                access,
                self.thread_id,
                ThreadPatch {
                    resolved: Some(self.resolved),
                    detach_anchor: false,
                    nonce: None,
                },
            )
            .await
            .map_err(comment_error("unable to update the comment thread"))?;

        Ok(ResolveDocumentCommentResponse {
            document_id: self.document_id,
            thread_id: state.root_id,
            resolved: state.resolved,
        })
    }
}
