//! CommentOnDocument tool for posting document comments and replies.

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
    title = "CommentOnDocument",
    description = "Comment on a document on behalf of the user. Pass threadId to reply in an existing inline or Discussion thread; pass quote to start a new inline comment on a passage of a Macro markdown or Word (DOCX) document; omit both to start a new Discussion comment on the document as a whole. Replies and Discussion comments support any document type. Only use this when explicitly asked to reply to or comment on a document. Thread ids come from the comments ReadContent returns. For an inline comment, quote the passage exactly as the document reads, as plain text without markdown syntax, within a single paragraph, heading, list item or table cell. If the passage appears more than once the tool refuses and lists each occurrence so you can choose one with occurrence, counting from 1; if the text is not found, read the document again rather than guessing. Do not combine threadId with quote. occurrence only applies with quote. Comments made here stay in Macro and are not written into a Word file; for comments that must travel with a Word document to its recipient (a redline for a counterparty), use EditWordDocument's addComment operation instead."
)]
pub struct CommentOnDocument {
    #[schemars(description = "The id of the document to comment on.")]
    pub document_id: Uuid,

    #[schemars(
        description = "Comment content in macro markdown format. This uses the same syntax as markdown documents."
    )]
    pub content: String,

    #[schemars(
        description = "The id of the inline or Discussion thread to reply in, from ReadContent. Cannot be combined with quote. Omit both threadId and quote to post a new Discussion comment on the document as a whole."
    )]
    pub thread_id: Option<Uuid>,

    #[schemars(
        description = "The passage to comment on, quoted exactly as the document reads: plain text without markdown syntax such as ** or link brackets. Keep it to the words the comment is about; a longer quote is more likely to be unique. Starts a new inline comment on a markdown or Word (DOCX) document. Cannot be combined with threadId."
    )]
    pub quote: Option<String>,

    #[schemars(
        range(min = 1),
        description = "Which appearance of the quoted passage to comment on, counting from 1 in document order. Only applies with quote; only needed when the passage appears more than once."
    )]
    pub occurrence: Option<u32>,
}

/// The posted comment.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentOnDocumentResponse {
    /// The document the comment was posted on.
    pub document_id: Uuid,
    /// The thread the comment is in; a new comment starts its own.
    pub thread_id: Uuid,
    /// The posted comment.
    pub comment_id: Uuid,
    /// The text the new inline comment is anchored to, as the document reads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marked_text: Option<String>,
}

impl ToolAnnotated for CommentOnDocument {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Comment on document");
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for CommentOnDocument
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = CommentOnDocumentResponse;

    #[tracing::instrument(skip_all, fields(document_id = %self.document_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.thread_id.is_some() && self.quote.is_some() {
            return Err(ToolCallError {
                description: "threadId and quote cannot be combined: pass threadId to reply or quote to start a new inline comment".to_string(),
                internal_error: anyhow::anyhow!("threadId and quote both provided"),
            });
        }
        if self.occurrence.is_some() && self.quote.is_none() {
            return Err(ToolCallError {
                description: "occurrence only applies with quote: provide a quote to choose an appearance of the passage".to_string(),
                internal_error: anyhow::anyhow!("occurrence provided without quote"),
            });
        }
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
        let Some(quote) = &self.quote else {
            let message = ctx
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

            return Ok(CommentOnDocumentResponse {
                document_id: self.document_id,
                thread_id: message.thread_id.unwrap_or(message.id),
                comment_id: message.id,
                marked_text: None,
            });
        };
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
            Some(FileType::Docx) => return self.comment_on_docx_text(&ctx, access, quote).await,
            _ => {
                return Err(ToolCallError {
                    description: "inline comments anchor to text in Macro markdown and Word documents only; omit quote to comment on this document as a whole".to_string(),
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
                quote,
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

        Ok(CommentOnDocumentResponse {
            document_id: self.document_id,
            thread_id: message.id,
            comment_id: message.id,
            marked_text: Some(marked_text),
        })
    }
}

impl CommentOnDocument {
    /// A Word document keeps its comment marks beside its collaborative
    /// blocks, where the editor places a thread by the text it quotes and pins
    /// it with a mark. The thread is posted with that quote and a fresh mark id;
    /// a quote the editor cannot find shows with the comments on changed text.
    async fn comment_on_docx_text<DSvc, ESvc, EDSvc>(
        &self,
        ctx: &ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        access: EntityAccessReceipt<MessageWrite>,
        quote: &str,
    ) -> ToolResult<CommentOnDocumentResponse>
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
        let marked_text = quote.trim();
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
        Ok(CommentOnDocumentResponse {
            document_id: self.document_id,
            thread_id: message.id,
            comment_id: message.id,
            marked_text: Some(marked_text.to_owned()),
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
