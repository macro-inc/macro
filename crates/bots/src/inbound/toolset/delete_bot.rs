//! DeleteBot tool.

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

/// Response from [`DeleteBot`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBotResponse {
    /// Deleted bot id.
    pub bot_id: Uuid,
    /// Whether the bot was deleted.
    pub deleted: bool,
    /// Human-readable result summary.
    pub summary: String,
}

/// Permanently disable and remove a manageable bot.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteBot",
    description = "Delete a bot the current user owns or a bot owned by a team they belong to. This removes the bot from every channel and disables its credentials and webhooks. The operation cannot be undone, so only use it after the user explicitly confirms deletion."
)]
pub struct DeleteBot {
    /// Bot to delete.
    #[schemars(description = "Bot id from ListBots.")]
    pub bot_id: Uuid,
}

impl ToolAnnotated for DeleteBot {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Delete bot");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for DeleteBot
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = DeleteBotResponse;

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
        service_context
            .service
            .delete_bot(request_context.user_id, BotId::new_from_uuid(self.bot_id))
            .await
            .map_err(|error| bot_tool_error("delete bot", error))?;

        Ok(DeleteBotResponse {
            bot_id: self.bot_id,
            deleted: true,
            summary: "Deleted the bot and disabled its credentials and webhooks.".to_string(),
        })
    }
}
