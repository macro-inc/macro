//! GetBotWebhooks tool.

use super::{
    BOT_WEBHOOK_SCOPE, BOT_WEBHOOK_SCOPE_HEADER, BOT_WEBHOOK_TOKEN_HEADER, BotToolContext,
    BotWebhook, bot_tool_error,
};
use crate::domain::{
    models::{BotChannelListCaller, BotId},
    ports::BotService,
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Response from [`GetBotWebhooks`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetBotWebhooksResponse {
    /// Bot whose webhook URLs were requested.
    pub bot_id: Uuid,
    /// Header where callers send a bearer token minted from the chat card or bot settings.
    pub credential_header: String,
    /// Header where callers send [`Self::credential_scope`].
    pub credential_scope_header: String,
    /// Required scope value for the bot credential.
    pub credential_scope: String,
    /// One webhook per channel where the bot currently has access.
    pub webhooks: Vec<BotWebhook>,
    /// Human-readable result summary.
    pub summary: String,
}

/// Get every channel webhook URL currently available to a bot.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "GetBotWebhooks",
    description = "Get the channel-specific webhook URLs for a bot the current user can manage. A bot has one URL per channel it can access. POST message content to a returned webhookUrl and authenticate with a token minted from the chat card or bot settings after IssueBotCredential or CreateBot; send it in the returned credentialHeader and send credentialScope in credentialScopeHeader. If no URLs are returned, add the bot to a channel with ManageBotChannelAccess or recreate it with CreateBot and channelId."
)]
pub struct GetBotWebhooks {
    /// Bot to inspect.
    #[schemars(description = "Bot id from CreateBot or ListBots.")]
    pub bot_id: Uuid,
}

impl ToolAnnotated for GetBotWebhooks {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Get bot webhooks");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for GetBotWebhooks
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = GetBotWebhooksResponse;

    #[tracing::instrument(
        skip_all,
        fields(user_id=?request_context.user_id, bot_id=%self.bot_id),
        err
    )]
    async fn call(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let channels = service_context
            .service
            .list_bot_channels(
                BotChannelListCaller::User(request_context.user_id),
                BotId::new_from_uuid(self.bot_id),
            )
            .await
            .map_err(|error| bot_tool_error("get bot webhooks", error))?;
        let webhooks: Vec<BotWebhook> = channels
            .into_iter()
            .map(|channel| BotWebhook {
                channel_id: channel.channel_id,
                channel_name: channel.name,
                webhook_url: BotWebhook::for_channel(
                    &service_context.document_storage_service_url,
                    channel.channel_id,
                )
                .webhook_url,
            })
            .collect();
        let summary = match webhooks.len() {
            0 => "This bot has no channel webhooks. Add it to a channel first.".to_string(),
            1 => "Found 1 channel webhook.".to_string(),
            count => format!("Found {count} channel webhooks."),
        };

        Ok(GetBotWebhooksResponse {
            bot_id: self.bot_id,
            credential_header: BOT_WEBHOOK_TOKEN_HEADER.to_string(),
            credential_scope_header: BOT_WEBHOOK_SCOPE_HEADER.to_string(),
            credential_scope: BOT_WEBHOOK_SCOPE.to_string(),
            webhooks,
            summary,
        })
    }
}
