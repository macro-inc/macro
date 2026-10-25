//! CommentOnText tool for inline comments on a passage of a document.

use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::models::EntityAccessReceipt;
use entity_access::domain::ports::EntityAccessService;
use macro_sync_service_jwt::DocumentPermissionToken;
use messages::domain::models::{
    MessageAttribution, NewThreadAnchor, PostMessage, PostMessageNotificationPolicy,
};
use messages::domain::service::MessageWrite;
use model::document::FileType;
use models_permissions::share_permission::access_level::AccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DocumentToolContext, comment_error};
use crate::domain::permission_token::encode_permission_token;
use crate::domain::ports::{
    DocumentService,
    create::DocumentCreationService,
    editing::{CommentMarkPlacement, EditingWorkerService},
};

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
        if self.occurrence == Some(0) {
            return Err(ToolCallError {
                description:
                    "occurrence counts from 1: pass 1 for the first appearance of the text"
                        .to_string(),
                internal_error: anyhow::anyhow!("occurrence 0"),
            });
        }
        let access = ctx
            .require_comment_write(&request_context, self.document_id)
            .await?;
        let document_id = self.document_id.to_string();

        let document = ctx
            .service
            .internal_get_basic_document(&document_id)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to look up this document".to_string(),
                internal_error: e.into(),
            })?;
        match document.try_file_type() {
            Some(FileType::Md) => {}
            Some(FileType::Docx) => return self.comment_on_docx_text(&ctx, access).await,
            _ => {
                return Err(ToolCallError {
                    description: "inline comments anchor to text in Macro markdown and Word documents only; use Comment to comment on this document as a whole".to_string(),
                    internal_error: anyhow::anyhow!(
                        "document file type {:?} does not support inline comments",
                        document.file_type
                    ),
                });
            }
        }

        // Placing the mark is a content change, but the one a commenter makes
        // whenever they comment on a selection, so comment access suffices, as
        // it does for the web composer and the sync service.
        let document_token = encode_permission_token(
            Some(request_context.user_id.to_string()),
            document_id.clone(),
            AccessLevel::Comment,
            &ctx.document_permission_jwt_secret,
            Some(ctx.actor.into_storage_id().to_string()),
        )
        .map_err(|e| ToolCallError {
            description: "failed to mint document token".to_string(),
            internal_error: e.into(),
        })?;

        // The mark goes in first: refusing an ambiguous or missing passage is
        // the likely failure, and it then leaves nothing behind, where a thread
        // posted first would already have notified people of a comment that
        // cannot be placed.
        let mark_id = Uuid::now_v7();
        let placement = match ctx
            .editing
            .add_comment_mark(
                &document_id,
                &document_token,
                mark_id,
                &self.quote,
                self.occurrence,
            )
            .await
        {
            Ok(placement) => placement,
            Err(err) => {
                // The worker may have pushed the mark before the failure reached
                // us, as when the sync service never acknowledged it.
                remove_mark(ctx.editing.as_ref(), &document_id, &document_token, mark_id).await;
                return Err(ToolCallError {
                    description: "unable to anchor the comment to the text".to_string(),
                    internal_error: err,
                });
            }
        };
        let marked_text = match placement {
            CommentMarkPlacement::Placed { marked_text } => marked_text,
            CommentMarkPlacement::Refused(reason) => {
                return Err(ToolCallError {
                    description: reason.clone(),
                    internal_error: anyhow::anyhow!("comment mark refused: {reason}"),
                });
            }
        };

        let posted = ctx
            .messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    notification_policy: PostMessageNotificationPolicy::Default,
                    content: self.content.clone(),
                    thread_id: None,
                    anchor: Some(NewThreadAnchor::Markdown {
                        mark_id,
                        marked_text: Some(marked_text.clone()),
                    }),
                    mentions: vec![],
                    attachments: vec![],
                    nonce: None,
                },
            )
            .await;
        let message = match posted {
            Ok(message) => message,
            Err(err) => {
                remove_mark(ctx.editing.as_ref(), &document_id, &document_token, mark_id).await;
                return Err(comment_error("unable to post the comment")(err));
            }
        };

        Ok(CommentOnTextResponse {
            document_id: self.document_id,
            thread_id: message.id,
            comment_id: message.id,
            marked_text,
        })
    }
}

impl CommentOnText {
    /// A Word document keeps its comment marks beside its collaborative
    /// blocks, where the editor places a thread by the text it quotes and pins
    /// it with a mark. The thread is posted with that quote and a fresh mark id;
    /// a quote the editor cannot find shows with the comments on changed text.
    async fn comment_on_docx_text<DSvc, ESvc, EDSvc>(
        &self,
        ctx: &ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        access: EntityAccessReceipt<MessageWrite>,
    ) -> ToolResult<CommentOnTextResponse>
    where
        DSvc: DocumentService + DocumentCreationService,
        ESvc: EntityAccessService,
        EDSvc: EditingWorkerService,
    {
        if self.occurrence.is_some_and(|occurrence| occurrence > 1) {
            return Err(ToolCallError {
                description: "comments on a Word document attach to the first appearance of the quoted text; quote a longer passage that appears only once".to_string(),
                internal_error: anyhow::anyhow!("occurrence {:?} on a docx", self.occurrence),
            });
        }
        let marked_text = self.quote.trim();
        if marked_text.is_empty() {
            return Err(ToolCallError {
                description: "quote the passage to comment on".to_string(),
                internal_error: anyhow::anyhow!("empty quote"),
            });
        }
        let message = ctx
            .messages
            .post(
                access,
                PostMessage {
                    id: None,
                    attribution: MessageAttribution::ActingUser,
                    notification_policy: PostMessageNotificationPolicy::Default,
                    content: self.content.clone(),
                    thread_id: None,
                    anchor: Some(NewThreadAnchor::Markdown {
                        mark_id: Uuid::now_v7(),
                        marked_text: Some(marked_text.to_owned()),
                    }),
                    mentions: vec![],
                    attachments: vec![],
                    nonce: None,
                },
            )
            .await
            .map_err(comment_error("unable to post the comment"))?;
        Ok(CommentOnTextResponse {
            document_id: self.document_id,
            thread_id: message.id,
            comment_id: message.id,
            marked_text: marked_text.to_owned(),
        })
    }
}

/// Best-effort removal of a mark whose thread was never posted: left in place
/// it would highlight text nobody commented on.
async fn remove_mark<EDSvc: EditingWorkerService>(
    editing: &EDSvc,
    document_id: &str,
    document_token: &DocumentPermissionToken,
    mark_id: Uuid,
) {
    if let Err(error) = editing
        .remove_comment_mark(document_id, document_token, mark_id)
        .await
    {
        tracing::error!(error = ?error, %mark_id, "comment mark left without its thread");
    }
}
