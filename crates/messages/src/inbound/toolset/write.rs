//! Project comment writes retain the shared authorship, moderation and delivery policy.

use super::*;
use crate::domain::{
    models::{Message, NewAttachment, PostMessage, SimpleMention, ThreadPatch, ThreadState},
    ports::{AttachmentChange, MessagePatch},
    service::MessageWrite,
};
use ai_toolset::{AsyncTool, ServiceContext, ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Start a discussion or reply to an existing project discussion.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "PostInitiativeComment",
    description = "Post a Markdown comment on a project, or reply to a project discussion. Requires comment access. The bot is the author and the requesting user is recorded as its invoker. Uses the shared discussions system, including mention authorization, realtime updates and notifications."
)]
pub struct PostInitiativeComment {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Markdown comment body.
    #[schemars(description = "Markdown comment body.")]
    pub content: String,
    /// Root message id to reply to. Omit to start a discussion.
    #[schemars(description = "Root message id to reply to. Omit to start a discussion.")]
    pub thread_id: Option<Uuid>,
    /// Explicit user/entity mentions; Markdown mentions are also extracted by the service.
    #[serde(default)]
    #[schemars(
        description = "Explicit user/entity mentions; Markdown mentions are also extracted by the service."
    )]
    pub mentions: Vec<SimpleMention>,
    /// Entity attachments, checked under the same caller's access.
    #[serde(default)]
    #[schemars(description = "Entity attachments, checked under the same caller's access.")]
    pub attachments: Vec<NewAttachment>,
}

impl ToolAnnotated for PostInitiativeComment {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Post project comment");
}

#[async_trait]
impl<A: EntityAccessService> AsyncTool<InitiativeDiscussionToolContext<A>>
    for PostInitiativeComment
{
    type Output = Message;
    async fn call(
        &self,
        context: ServiceContext<InitiativeDiscussionToolContext<A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<MessageWrite>(&request, self.initiative_id)
            .await?;
        context
            .service
            .post(
                receipt,
                PostMessage {
                    id: None,
                    attribution: Default::default(),
                    notification_policy: Default::default(),
                    content: self.content.clone(),
                    thread_id: self.thread_id,
                    anchor: None,
                    mentions: self.mentions.clone(),
                    attachments: self.attachments.clone(),
                    nonce: None,
                },
            )
            .await
            .map_err(failure)
    }
}

/// Edit an authored comment under common authorship and moderation rules.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "UpdateInitiativeComment",
    description = "Edit a project comment's Markdown or attachments. The shared discussion service enforces authorship: having project edit access alone does not authorize rewriting another author's comment. Omitted fields are unchanged."
)]
pub struct UpdateInitiativeComment {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Comment identifier.
    #[schemars(description = "Comment identifier.")]
    pub message_id: Uuid,
    /// Replacement Markdown body.
    #[schemars(description = "Replacement Markdown body.")]
    pub content: Option<String>,
    /// Replacement explicit mentions; omitted preserves the existing authored mentions.
    #[schemars(
        description = "Replacement explicit mentions; omitted preserves the existing authored mentions."
    )]
    pub mentions: Option<Vec<SimpleMention>>,
    /// Existing attachment ids to remove.
    #[serde(default)]
    #[schemars(description = "Existing attachment ids to remove.")]
    pub remove_attachment_ids: Vec<Uuid>,
    /// New attachments to append.
    #[serde(default)]
    #[schemars(description = "New attachments to append.")]
    pub add_attachments: Vec<NewAttachment>,
}

impl ToolAnnotated for UpdateInitiativeComment {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Edit project comment");
}

#[async_trait]
impl<A: EntityAccessService> AsyncTool<InitiativeDiscussionToolContext<A>>
    for UpdateInitiativeComment
{
    type Output = Message;
    async fn call(
        &self,
        context: ServiceContext<InitiativeDiscussionToolContext<A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<MessageWrite>(&request, self.initiative_id)
            .await?;
        context
            .service
            .patch(
                receipt,
                self.message_id,
                MessagePatch {
                    content: self.content.clone(),
                    mentions: self.mentions.clone(),
                    attachments: AttachmentChange::Delta {
                        remove: self.remove_attachment_ids.clone(),
                        add: self.add_attachments.clone(),
                    },
                    ..Default::default()
                },
            )
            .await
            .map_err(failure)
    }
}

/// Delete a comment or its whole discussion using common moderation policy.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteInitiativeComment",
    description = "Delete a project comment, or delete an entire discussion when wholeDiscussion is true and messageId is its root id. Comment deletion leaves a tombstone so replies remain readable; whole-discussion deletion hides the thread. The service enforces author and project moderation permissions."
)]
pub struct DeleteInitiativeComment {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Comment id, or root id for whole-discussion deletion.
    #[schemars(description = "Comment id, or root id for whole-discussion deletion.")]
    pub message_id: Uuid,
    /// Delete the entire discussion rather than one comment. Defaults to false.
    #[serde(default)]
    #[schemars(
        description = "Delete the entire discussion rather than one comment. Defaults to false."
    )]
    pub whole_discussion: bool,
}

/// The requested discussion operation completed.
#[derive(Debug, Serialize, JsonSchema)]
pub struct DiscussionOperationComplete {
    /// True after successful completion.
    pub success: bool,
}

impl ToolAnnotated for DeleteInitiativeComment {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Delete project comment").with_idempotent();
}

#[async_trait]
impl<A: EntityAccessService> AsyncTool<InitiativeDiscussionToolContext<A>>
    for DeleteInitiativeComment
{
    type Output = DiscussionOperationComplete;
    async fn call(
        &self,
        context: ServiceContext<InitiativeDiscussionToolContext<A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<MessageWrite>(&request, self.initiative_id)
            .await?;
        if self.whole_discussion {
            context
                .service
                .delete_thread(receipt, self.message_id, None)
                .await
                .map_err(failure)?;
        } else {
            context
                .service
                .delete(receipt, self.message_id, None)
                .await
                .map_err(failure)?;
        }
        Ok(DiscussionOperationComplete { success: true })
    }
}

/// Add or remove the bot actor's reaction.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReactToInitiativeComment",
    description = "Add or remove the acting bot's emoji reaction on a project comment. Requires comment access and a live comment in that project."
)]
pub struct ReactToInitiativeComment {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Comment identifier.
    #[schemars(description = "Comment identifier.")]
    pub message_id: Uuid,
    /// Emoji to react with.
    #[schemars(description = "Emoji to react with.")]
    pub emoji: String,
    /// True adds the reaction; false removes it.
    #[schemars(description = "True adds the reaction; false removes it.")]
    pub add: bool,
}

impl ToolAnnotated for ReactToInitiativeComment {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Change project comment reaction").with_idempotent();
}

#[async_trait]
impl<A: EntityAccessService> AsyncTool<InitiativeDiscussionToolContext<A>>
    for ReactToInitiativeComment
{
    type Output = Message;
    async fn call(
        &self,
        context: ServiceContext<InitiativeDiscussionToolContext<A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<MessageWrite>(&request, self.initiative_id)
            .await?;
        context
            .service
            .react(receipt, self.message_id, self.emoji.clone(), self.add, None)
            .await
            .map_err(failure)
    }
}

/// Resolve or reopen a project discussion.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "SetInitiativeDiscussionResolved",
    description = "Resolve or reopen a project discussion using the shared discussion policy. Requires comment access and any additional author/moderator permissions enforced by the discussion service."
)]
pub struct SetInitiativeDiscussionResolved {
    /// Project identifier.
    #[schemars(description = "Project identifier.")]
    pub initiative_id: Uuid,
    /// Root message id of the discussion.
    #[schemars(description = "Root message id of the discussion.")]
    pub thread_id: Uuid,
    /// True resolves; false reopens.
    #[schemars(description = "True resolves; false reopens.")]
    pub resolved: bool,
}

impl ToolAnnotated for SetInitiativeDiscussionResolved {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Resolve project discussion").with_idempotent();
}

#[async_trait]
impl<A: EntityAccessService> AsyncTool<InitiativeDiscussionToolContext<A>>
    for SetInitiativeDiscussionResolved
{
    type Output = ThreadState;
    async fn call(
        &self,
        context: ServiceContext<InitiativeDiscussionToolContext<A>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = context
            .receipt::<MessageWrite>(&request, self.initiative_id)
            .await?;
        context
            .service
            .patch_thread(
                receipt,
                self.thread_id,
                ThreadPatch {
                    resolved: Some(self.resolved),
                    ..Default::default()
                },
            )
            .await
            .map_err(failure)
    }
}
