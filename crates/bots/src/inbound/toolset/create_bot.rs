//! CreateBot tool.

use super::{BotSummary, BotToolContext, bot_tool_error};
use crate::domain::{models::CreateBotRequest, ports::BotService};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
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
    /// Human-readable result summary.
    pub summary: String,
}

/// Create a user- or team-owned bot.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateBot",
    description = "Create a bot with a name, stable handle, and optional profile. Omit teamId to create a bot owned by the current user; provide teamId to create a team-owned bot, which requires team administrator or owner permission. This creates the bot only. Use ManageBotChannelAccess to add it to channels and IssueBotCredential to mint a secret token."
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
                },
            )
            .await
            .map_err(|error| bot_tool_error("create bot", error))?
            .into();
        let summary = format!("Created bot @{}.", bot.handle);

        Ok(CreateBotResponse { bot, summary })
    }
}
