//! CreateBot tool.

use super::{
    BOT_WEBHOOK_SCOPE, BOT_WEBHOOK_SCOPE_HEADER, BOT_WEBHOOK_TOKEN_HEADER, BotSummary,
    BotToolContext, BotWebhook, CreatedBotChannelSetup, bot_tool_error,
};
use crate::domain::{models::CreateBotRequest, ports::BotService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Response from [`CreateBot`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateBotResponse {
    /// Newly created bot.
    pub bot: BotSummary,
    /// Channel webhook and credential proposal returned when [`CreateBot::channel_id`] was set.
    pub channel_setup: Option<CreatedBotChannelSetup>,
    /// Human-readable result summary.
    pub summary: String,
}

/// Create a user- or team-owned bot, optionally ready to post in one channel.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateBot",
    description = "Create a bot with a name, stable handle, and optional profile. Omit teamId for a bot owned by the current user; provide teamId to create a team-owned bot, which requires team administrator or owner permission. Pass channelId when the bot should post to a channel immediately: the current user must be a member of that channel. The response then includes that channel's webhook URL and a credential proposal. The user mints the bearer token from the chat card or bot settings; the secret is never returned in this tool result. Omit channelId to create the bot only, then use ManageBotChannelAccess and IssueBotCredential for later setup."
)]
pub struct CreateBot {
    /// Team owner; omit for a user-owned bot.
    #[schemars(
        description = "Team id that should own the bot. Omit for a bot owned by the current user."
    )]
    #[serde(default)]
    pub team_id: Option<Uuid>,
    /// Bot display name.
    #[schemars(description = "Human-readable display name for the bot.")]
    pub name: String,
    /// Stable lowercase handle.
    #[schemars(
        description = "Stable mention handle using only lowercase ASCII letters, digits, hyphens, and underscores; maximum 64 characters."
    )]
    pub handle: String,
    /// Optional bot description.
    #[schemars(description = "Optional short description of what the bot does.")]
    #[serde(default)]
    pub description: Option<String>,
    /// Optional profile-picture URL.
    #[schemars(
        description = "Optional URL for the bot profile picture. Pass the URL of an image already uploaded to Macro static files or another reachable image URL."
    )]
    #[serde(default)]
    pub avatar_url: Option<String>,
    /// Optional channel to grant immediately.
    #[schemars(
        description = "Channel id to grant the new bot access to. Requires current-user channel membership. When set, the tool also returns the channel webhook URL and a credential proposal the user can mint from the chat card."
    )]
    #[serde(default)]
    pub channel_id: Option<Uuid>,
    /// Optional credential label used only with [`Self::channel_id`].
    #[schemars(
        description = "Optional label for the credential the user will mint when channelId is set, such as `github-webhook`. Requires channelId."
    )]
    #[serde(default)]
    pub credential_label: Option<String>,
    /// Optional credential expiry used only with [`Self::channel_id`].
    #[schemars(
        description = "Optional RFC 3339 expiration for the credential the user will mint when channelId is set. Requires channelId."
    )]
    #[serde(default)]
    pub credential_expires_at: Option<DateTime<Utc>>,
    /// Optional coding-agent session flag.
    #[schemars(
        description = "Set true if mentioning this bot should open a sandboxed coding-agent session. Defaults to false."
    )]
    #[serde(default)]
    pub has_agent: Option<bool>,
}

impl ToolAnnotated for CreateBot {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create bot");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for CreateBot
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = CreateBotResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.channel_id.is_none()
            && (self.credential_label.is_some() || self.credential_expires_at.is_some())
        {
            return Err(ToolCallError {
                description: "credentialLabel and credentialExpiresAt require channelId. Pass channelId to create a channel-ready bot, or omit those fields to create the bot only.".to_string(),
                internal_error: anyhow::anyhow!("credential fields without channel_id"),
            });
        }

        match self.channel_id {
            Some(channel_id) => {
                self.create_for_channel(service_context, request_context, channel_id)
                    .await
            }
            None => {
                self.create_standalone(service_context, request_context)
                    .await
            }
        }
    }
}

impl CreateBot {
    async fn create_standalone<Svc, AccessSvc>(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<CreateBotResponse>
    where
        Svc: BotService,
        AccessSvc: EntityAccessService,
    {
        let bot: BotSummary = service_context
            .service
            .create_bot(
                request_context.user_id,
                CreateBotRequest {
                    team_id: self.team_id,
                    name: self.name.clone(),
                    handle: self.handle.clone(),
                    description: self.description.clone(),
                    avatar_url: self.avatar_url.clone(),
                    has_agent: self.has_agent,
                },
            )
            .await
            .map_err(|error| bot_tool_error("create bot", error))?
            .try_into()?;
        let summary = format!("Created bot @{}.", bot.handle);

        Ok(CreateBotResponse {
            bot,
            channel_setup: None,
            summary,
        })
    }

    async fn create_for_channel<Svc, AccessSvc>(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
        channel_id: Uuid,
    ) -> ToolResult<CreateBotResponse>
    where
        Svc: BotService,
        AccessSvc: EntityAccessService,
    {
        let access = service_context
            .require_channel_member(&request_context, channel_id)
            .await?;
        let caller = request_context.user_id.clone();
        let bot = service_context
            .service
            .create_bot(
                caller.clone(),
                CreateBotRequest {
                    team_id: self.team_id,
                    name: self.name.clone(),
                    handle: self.handle.clone(),
                    description: self.description.clone(),
                    avatar_url: self.avatar_url.clone(),
                    has_agent: self.has_agent,
                },
            )
            .await
            .map_err(|error| bot_tool_error("create bot", error))?;
        if let Err(error) = service_context
            .service
            .add_bot_to_channel(access, bot.id)
            .await
        {
            let _ = service_context
                .service
                .delete_bot(caller, bot.id)
                .await
                .inspect_err(|cleanup_error| {
                    tracing::error!(
                        error=?cleanup_error,
                        "failed to delete bot after channel grant failed"
                    );
                });
            return Err(bot_tool_error("grant bot channel access", error));
        }
        let bot = BotSummary::try_from(bot)?;
        let webhook =
            BotWebhook::for_channel(&service_context.document_storage_service_url, channel_id);
        let summary = format!(
            "Created bot @{} and granted it access to the channel. Click the card or open bot settings to create a token. The secret is shown only while that card is open.",
            bot.handle
        );

        Ok(CreateBotResponse {
            bot,
            channel_setup: Some(CreatedBotChannelSetup {
                channel_id,
                webhook,
                credential_header: BOT_WEBHOOK_TOKEN_HEADER.to_string(),
                credential_scope_header: BOT_WEBHOOK_SCOPE_HEADER.to_string(),
                credential_scope: BOT_WEBHOOK_SCOPE.to_string(),
                credential_label: self.credential_label.clone(),
                credential_expires_at: self.credential_expires_at,
            }),
            summary,
        })
    }
}
