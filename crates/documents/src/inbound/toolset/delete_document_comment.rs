//! DeleteDocumentComment tool for deleting a comment, reply, or whole thread.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use messages::domain::ports::MessageError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DocumentToolContext, comment_error};
use crate::domain::ports::{
    DocumentService, create::DocumentCreationService, editing::EditingWorkerService,
};

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteDocumentComment",
    description = "Delete a comment or reply on a document. Deleting the first comment of a thread deletes the whole thread with its replies. Authors can delete their own comments, and the document owner can delete any comment. This cannot be undone. Comment ids come from the comments ReadContent returns. Use only when the user explicitly asks to delete a comment; use ResolveDocumentComment to close a thread instead."
)]
pub struct DeleteDocumentComment {
    #[schemars(description = "The id of the document the comment is on.")]
    pub document_id: Uuid,

    #[schemars(
        description = "The id of the comment or reply to delete, from ReadContent. Pass the thread id to delete the whole thread."
    )]
    pub comment_id: Uuid,
}

/// The deleted comment.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteDocumentCommentResponse {
    /// The document the comment was on.
    pub document_id: Uuid,
    /// The deleted comment.
    pub comment_id: Uuid,
    /// Whether the whole thread was deleted.
    pub deleted_thread: bool,
}

impl ToolAnnotated for DeleteDocumentComment {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Delete document comment").with_idempotent();
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for DeleteDocumentComment
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = DeleteDocumentCommentResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, document_id=%self.document_id, comment_id=%self.comment_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = service_context
            .require_comment_author_write(&request_context, self.document_id, self.comment_id)
            .await?;
        let deleted = service_context
            .messages
            .delete(access, self.comment_id, None)
            .await
            .map_err(|error| match error {
                MessageError::Forbidden => ToolCallError {
                    description: "only the comment's author or the document owner can delete it"
                        .to_string(),
                    internal_error: anyhow::Error::new(error),
                },
                error => comment_error("unable to delete the comment")(error),
            })?;

        Ok(DeleteDocumentCommentResponse {
            document_id: self.document_id,
            comment_id: self.comment_id,
            deleted_thread: deleted.thread_id.is_none(),
        })
    }
}
