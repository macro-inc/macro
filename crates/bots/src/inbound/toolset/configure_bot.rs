//! ConfigureBot tool.

use super::{BotSummary, BotToolContext, bot_tool_error};
use crate::domain::{
    models::{BotId, PatchBotRequest},
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

/// Response from [`ConfigureBot`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureBotResponse {
    /// Updated bot profile.
    pub bot: BotSummary,
    /// Human-readable result summary.
    pub summary: String,
}

/// Update a bot's display profile and stable handle.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ConfigureBot",
    description = "Configure a manageable bot's profile. Provide only fields that should change. Use avatarUrl to set a profile picture from an image already uploaded to Macro static files or another reachable image URL; pass an empty string to clear the current picture. Passing an empty string for description clears it. Confirm handle changes because integrations and mentions may rely on the stable handle."
)]
pub struct ConfigureBot {
    /// Bot to configure.
    #[schemars(description = "Bot id from CreateBot or ListBots.")]
    pub bot_id: Uuid,
    /// Optional replacement display name.
    #[schemars(description = "New display name. Omit to keep the current name.")]
    #[serde(default)]
    pub name: Option<String>,
    /// Optional replacement handle.
    #[schemars(
        description = "New stable handle using lowercase ASCII letters, digits, hyphens, and underscores. Omit to keep the current handle."
    )]
    #[serde(default)]
    pub handle: Option<String>,
    /// Optional replacement description.
    #[schemars(
        description = "New bot description. Omit to keep the current value; pass an empty string to clear it."
    )]
    #[serde(default)]
    pub description: Option<String>,
    /// Optional replacement profile-picture URL.
    #[schemars(
        description = "New profile-picture URL. Use a Macro static-file URL or another reachable image URL. Omit to keep the current picture; pass an empty string to clear it."
    )]
    #[serde(default)]
    pub avatar_url: Option<String>,
    /// Optional coding-agent session flag.
    #[schemars(
        description = "Set true if mentioning this bot should open a sandboxed coding-agent session. Omit to leave unchanged."
    )]
    #[serde(default)]
    pub has_agent: Option<bool>,
}

impl ToolAnnotated for ConfigureBot {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Configure bot");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for ConfigureBot
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = ConfigureBotResponse;

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
        let bot = BotSummary::try_from(
            service_context
                .service
                .patch_bot(
                    request_context.user_id,
                    BotId::new_from_uuid(self.bot_id),
                    PatchBotRequest {
                        name: self.name.clone(),
                        handle: self.handle.clone(),
                        description: self.description.clone(),
                        avatar_url: self.avatar_url.clone(),
                        has_agent: self.has_agent,
                    },
                )
                .await
                .map_err(|error| bot_tool_error("configure bot", error))?,
        )?;
        let summary = format!("Updated bot @{}.", bot.handle);

        Ok(ConfigureBotResponse { bot, summary })
    }
}
