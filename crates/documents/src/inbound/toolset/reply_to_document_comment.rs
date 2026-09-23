//! ReplyToDocumentComment tool for answering document comments in place.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use messages::domain::models::{MessageAttribution, PostMessage, PostMessageNotificationPolicy};
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
    title = "ReplyToDocumentComment",
    description = "Reply in a comment thread on a document, or post a new comment in the document's Discussion panel, on behalf of the user. Only use this when explicitly asked to reply to or comment on a document. Thread ids come from the comments ReadContent returns. Cannot start a new inline comment on selected text."
)]
pub struct ReplyToDocumentComment {
    #[schemars(description = "The id of the document the comment is on.")]
    pub document_id: Uuid,

    #[schemars(
        description = "Comment content in macro markdown format. This uses the same syntax as markdown documents."
    )]
    pub content: String,

    #[schemars(
        description = "The id of the inline or Discussion thread to reply in, from ReadContent. Omit to post a new Discussion comment on the document as a whole."
    )]
    pub thread_id: Option<Uuid>,
}

/// The posted comment.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReplyToDocumentCommentResponse {
    /// The document the comment was posted on.
    pub document_id: Uuid,
    /// The thread the comment is in; a new Discussion comment starts its own.
    pub thread_id: Uuid,
    /// The posted comment.
    pub comment_id: Uuid,
}

impl ToolAnnotated for ReplyToDocumentComment {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Reply to document comment");
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for ReplyToDocumentComment
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = ReplyToDocumentCommentResponse;

    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = service_context
            .require_comment_write(&request_context, self.document_id)
            .await?;

        let message = service_context
            .messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    notification_policy: PostMessageNotificationPolicy::Default,
                    content: self.content.clone(),
                    thread_id: self.thread_id,
                    anchor: None,
                    mentions: vec![],
                    attachments: vec![],
                    nonce: None,
                },
            )
            .await
            .map_err(comment_error("unable to post the comment"))?;

        Ok(ReplyToDocumentCommentResponse {
            document_id: self.document_id,
            thread_id: message.thread_id.unwrap_or(message.id),
            comment_id: message.id,
        })
    }
}
