use super::{ChannelToolContext, message_mutation_error};
use crate::domain::ports::ChannelService;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Whether to add or remove a reaction.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReactionAction {
    /// Add the user's reaction.
    #[default]
    Add,
    /// Remove the user's reaction.
    Remove,
}

/// Response from [`ReactToChannelMessage`].
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReactToChannelMessageResponse {
    /// Channel containing the message.
    pub channel_id: Uuid,
    /// Message reacted to.
    pub message_id: Uuid,
    /// Emoji added or removed.
    pub emoji: String,
    /// Whether the reaction was added or removed.
    pub action: ReactionAction,
    /// How many people reacted with this emoji after the change.
    pub count: usize,
}

/// Add or remove the user's emoji reaction on a channel message.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReactToChannelMessage",
    description = "Add or remove the user's own emoji reaction on a channel message or thread reply. The reaction is shown as coming from the user. Find message ids with ReadChannelMessages or ReadChannelThread. Use only when the user asks to react to a message."
)]
pub struct ReactToChannelMessage {
    /// Channel containing the message.
    #[schemars(description = "Channel id containing the message.")]
    pub channel_id: Uuid,
    /// Message to react to.
    #[schemars(description = "Id of the message to react to.")]
    pub message_id: Uuid,
    /// The emoji character.
    #[schemars(
        description = "The emoji itself as a Unicode character, for example 👍 or 🎉 — not a shortcode like :thumbsup:."
    )]
    pub emoji: String,
    /// Add or remove.
    #[schemars(description = "Whether to add or remove the user's reaction. Defaults to add.")]
    #[serde(default)]
    pub action: ReactionAction,
}

impl ToolAnnotated for ReactToChannelMessage {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("React to channel message").with_idempotent();
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<ChannelToolContext<Svc, AccessSvc>> for ReactToChannelMessage
where
    Svc: ChannelService,
    AccessSvc: EntityAccessService,
{
    type Output = ReactToChannelMessageResponse;

    #[tracing::instrument(
        skip_all,
        fields(user_id=?request_context.user_id, channel_id=%self.channel_id, message_id=%self.message_id),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<ChannelToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let emoji = self.emoji.trim();
        if emoji.is_empty() || emoji.starts_with(':') {
            return Err(ToolCallError {
                description:
                    "emoji must be a Unicode emoji character such as 👍, not empty or a :shortcode:"
                        .to_string(),
                internal_error: anyhow::anyhow!("invalid reaction emoji"),
            });
        }
        let access = service_context
            .require_user_message_write(&request_context, self.channel_id)
            .await?;
        let message = service_context
            .messages
            .react(
                access,
                self.message_id,
                emoji.to_string(),
                self.action == ReactionAction::Add,
                None,
            )
            .await
            .map_err(message_mutation_error("react to this message"))?;
        let count = message
            .reactions
            .iter()
            .find(|reaction| reaction.emoji == emoji)
            .map_or(0, |reaction| reaction.users.len());

        Ok(ReactToChannelMessageResponse {
            channel_id: self.channel_id,
            message_id: self.message_id,
            emoji: emoji.to_string(),
            action: self.action,
            count,
        })
    }
}
