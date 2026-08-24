//! ListBots tool.

use super::{BotSummary, BotToolContext, bot_tool_error};
use crate::domain::ports::BotService;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Response from [`ListBots`].
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListBotsResponse {
    /// Active bots the caller can manage.
    pub bots: Vec<BotSummary>,
    /// Human-readable result summary.
    pub summary: String,
}

/// List bots owned by the user or by teams they belong to.
#[derive(Debug, Clone, Default, Deserialize, JsonSchema)]
#[schemars(
    title = "ListBots",
    description = "List every active bot the current user can manage, including user-owned bots and bots owned by teams they belong to. Use this to discover a botId before issuing credentials, reading webhook URLs, changing channel access, configuring, or deleting a bot."
)]
pub struct ListBots {}

impl ToolAnnotated for ListBots {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List bots");
}

#[async_trait]
impl<Svc, AccessSvc> AsyncTool<BotToolContext<Svc, AccessSvc>> for ListBots
where
    Svc: BotService,
    AccessSvc: EntityAccessService,
{
    type Output = ListBotsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<BotToolContext<Svc, AccessSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let bots: Vec<BotSummary> = service_context
            .service
            .list_bots(request_context.user_id)
            .await
            .map_err(|error| bot_tool_error("list bots", error))?
            .into_iter()
            .map(BotSummary::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        let summary = match bots.len() {
            0 => "No manageable bots found.".to_string(),
            1 => "Found 1 manageable bot.".to_string(),
            count => format!("Found {count} manageable bots."),
        };

        Ok(ListBotsResponse { bots, summary })
    }
}
