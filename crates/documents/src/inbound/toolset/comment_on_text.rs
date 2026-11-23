//! CommentOnText tool for inline comments on a passage of a document.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DocumentToolContext, comment_error};
use crate::domain::ports::{
    DocumentService, create::DocumentCreationService, editing::EditingWorkerService,
};
use crate::domain::text_comment::{TextCommentError, TextCommentRequest, comment_on_text};

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CommentOnText",
    description = "Start an inline comment on a passage of a Macro markdown or Word (DOCX) document on behalf of the user, anchored to the quoted text. Only use this when explicitly asked to comment on specific text. Quote the passage exactly as the document reads, as plain text without markdown syntax, within a single paragraph, heading, list item or table cell. If the passage appears more than once the tool refuses and lists each occurrence so you can choose one with occurrence, counting from 1; if the text is not found, read the document again rather than guessing. For a comment on a document as a whole, or a reply in an existing thread, use Comment. Comments made here stay in Macro and are not written into a Word file; for comments that must travel with a Word document to its recipient (a redline for a counterparty), use EditWordDocument's addComment operation instead."
)]
pub struct CommentOnText {
    #[schemars(description = "The id of the document to comment on.")]
    pub document_id: Uuid,

    #[schemars(
        description = "Comment content in macro markdown format. This uses the same syntax as markdown documents."
    )]
    pub content: String,

    #[schemars(
        description = "The passage to comment on, quoted exactly as the document reads: plain text without markdown syntax such as ** or link brackets. Keep it to the words the comment is about; a longer quote is more likely to be unique."
    )]
    pub quote: String,

    #[schemars(
        range(min = 1),
        description = "Which appearance of the quoted passage to comment on, counting from 1 in document order. Only needed when the passage appears more than once."
    )]
    pub occurrence: Option<u32>,
}

/// The posted comment.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentOnTextResponse {
    /// The document the comment was posted on.
    pub document_id: Uuid,
    /// The thread the comment starts.
    pub thread_id: Uuid,
    /// The posted comment.
    pub comment_id: Uuid,
    /// The text the comment is anchored to, as the document reads.
    pub marked_text: String,
}

impl ToolAnnotated for CommentOnText {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Comment on text");
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for CommentOnText
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = CommentOnTextResponse;

    #[tracing::instrument(skip_all, fields(document_id = %self.document_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let access = ctx
            .require_comment_write(&request_context, self.document_id)
            .await?;
        let document = ctx
            .service
            .internal_get_basic_document(&self.document_id.to_string())
            .await
            .map_err(|e| ToolCallError {
                description: "unable to look up this document".to_string(),
                internal_error: e.into(),
            })?;
        let comment = comment_on_text(
            ctx.editing.as_ref(),
            ctx.messages.as_ref(),
            &ctx.document_permission_jwt_secret,
            access,
            &document,
            ctx.attribution(),
            TextCommentRequest {
                content: &self.content,
                mentions: vec![],
                quote: &self.quote,
                occurrence: self.occurrence,
            },
        )
        .await
        .map_err(tool_error)?;
        Ok(CommentOnTextResponse {
            document_id: self.document_id,
            thread_id: comment.message.id,
            comment_id: comment.message.id,
            marked_text: comment.marked_text,
        })
    }
}

fn tool_error(error: TextCommentError) -> ToolCallError {
    match error {
        TextCommentError::Invalid(description) | TextCommentError::Refused(description) => {
            ToolCallError {
                internal_error: anyhow::anyhow!("comment on text refused: {description}"),
                description,
            }
        }
        TextCommentError::Anchor(error) => ToolCallError {
            description: "unable to anchor the comment to the text".to_string(),
            internal_error: error,
        },
        TextCommentError::Message(error) => comment_error("unable to post the comment")(error),
        TextCommentError::Document(error) => ToolCallError {
            description: "unable to comment on this document".to_string(),
            internal_error: error.into(),
        },
    }
}
