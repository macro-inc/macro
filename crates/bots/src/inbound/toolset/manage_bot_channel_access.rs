//! ManageBotChannelAccess tool.

use super::{BotToolContext, bot_tool_error};
use crate::domain::{models::BotId, ports::BotService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Channel-access change to apply to a bot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BotChannelAccessAction {
    /// Add the bot to the channel.
    Grant,
    /// Remove the bot from the channel.
    Revoke,
}

/// Response from [`ManageBotChannelAccess`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ManageBotChannelAccessResponse {
    /// Bot whose channel access changed.
    pub bot_id: Uuid,
    /// Affected channel.
    pub channel_id: Uuid,
    /// Applied access change.
    pub action: BotChannelAccessAction,
    /// Human-readable result summary.
    pub summary: String,
}

/// Grant or revoke a bot's access to one channel.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ManageBotChannelAccess",
    description = "Grant or revoke a manageable bot's access to one channel. Granting requires the current user to be a channel member. Both actions require the user to own the bot or belong to its owning team; revoking still works after the manager leaves the channel. Granting access creates that channel's webhook URL; revoking access disables posting to that channel. Use only after the user asks to change bot access."
)]
pub struct ManageBotChannelAccess {
    /// Bot to add or remove.
    #[schemars(description = "Bot id from CreateBot or ListBots.")]
    pub bot_id: Uuid,
    /// Channel whose bot access should change.
    #[schemars(description = "Channel id to grant or revoke access to.")]
    pub channel_id: Uuid,
    /// Access change.
    #[schemars(description = "Use `grant` to add the bot or `revoke` to remove it.")]
    pub action: BotChannelAccessAction,
}

impl ToolAnnotated for ManageBotChannelAccess {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Manage bot channel access");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for ManageBotChannelAccess
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = ManageBotChannelAccessResponse;

    #[tracing::instrument(
        skip_all,
        fields(
            user_id=?request_context.user_id,
            bot_id=%self.bot_id,
            channel_id=%self.channel_id,
            action=?self.action
        ),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let bot_id = BotId::new_from_uuid(self.bot_id);
        let summary = match self.action {
            BotChannelAccessAction::Grant => {
                let access = service_context
                    .require_channel_member(&request_context, self.channel_id)
                    .await?;
                service_context
                    .service
                    .add_bot_to_channel(access, bot_id)
                    .await
                    .map_err(|error| bot_tool_error("grant bot channel access", error))?;
                "Granted the bot access to the channel.".to_string()
            }
            BotChannelAccessAction::Revoke => {
                service_context
                    .service
                    .remove_bot_from_channel(request_context.user_id, self.channel_id, bot_id)
                    .await
                    .map_err(|error| bot_tool_error("revoke bot channel access", error))?;
                "Revoked the bot's access to the channel.".to_string()
            }
        };

        Ok(ManageBotChannelAccessResponse {
            bot_id: self.bot_id,
            channel_id: self.channel_id,
            action: self.action,
            summary,
        })
    }
}
