//! EditDocumentComment tool for rewriting a comment or reply on a document.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use messages::domain::ports::{MessageError, MessagePatch};
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
    title = "EditDocumentComment",
    description = "Replace the text of a comment or reply on a document. Only a comment's author can edit it, so this edits comments the user wrote and comments this assistant wrote for them. Comment ids come from the comments ReadContent returns. Use only when the user asks to edit a comment."
)]
pub struct EditDocumentComment {
    #[schemars(description = "The id of the document the comment is on.")]
    pub document_id: Uuid,

    #[schemars(
        description = "The id of the comment or reply to edit, from ReadContent. For the first comment of a thread this is the thread id."
    )]
    pub comment_id: Uuid,

    #[schemars(description = "The full replacement text of the comment, in markdown.")]
    pub content: String,
}

/// The edited comment.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditDocumentCommentResponse {
    /// The document the comment is on.
    pub document_id: Uuid,
    /// The edited comment.
    pub comment_id: Uuid,
}

impl ToolAnnotated for EditDocumentComment {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Edit document comment").with_idempotent();
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for EditDocumentComment
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = EditDocumentCommentResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, document_id=%self.document_id, comment_id=%self.comment_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.content.trim().is_empty() {
            return Err(ToolCallError {
                description:
                    "comment text must not be empty; use DeleteDocumentComment to remove a comment"
                        .to_string(),
                internal_error: anyhow::anyhow!("empty comment edit"),
            });
        }
        let access = service_context
            .require_comment_author_write(&request_context, self.document_id, self.comment_id)
            .await?;
        service_context
            .messages
            .patch(
                access,
                self.comment_id,
                MessagePatch {
                    content: Some(self.content.clone()),
                    ..MessagePatch::default()
                },
            )
            .await
            .map_err(|error| match error {
                MessageError::Forbidden => ToolCallError {
                    description: "only the comment's author can edit it".to_string(),
                    internal_error: anyhow::Error::new(error),
                },
                error => comment_error("unable to edit the comment")(error),
            })?;

        Ok(EditDocumentCommentResponse {
            document_id: self.document_id,
            comment_id: self.comment_id,
        })
    }
}
