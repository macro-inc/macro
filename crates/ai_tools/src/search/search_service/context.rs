use crate::tool_context::{ToolEmailService, ToolPropertiesService, ToolServiceContext};
use ai_usage::AiFeature;
use axum::extract::FromRef;
use search_service_client::SearchServiceClient;
use std::sync::Arc;
use uuid::Uuid;

/// Context for the search tools.
///
/// Carries the search client plus, when the request is an interactive chat, the
/// id of the chat the agent is running inside. The search tools use that id to
/// drop the current chat from their results so the agent never "finds itself".
#[derive(Clone)]
pub struct SearchToolContext {
    /// Client used to perform the unified search.
    pub search_client: Arc<SearchServiceClient>,
    /// Email service used to resolve an `inbox` selector to a link id when a
    /// search is scoped to a single inbox.
    pub email_service: Arc<ToolEmailService>,
    /// Properties service used to resolve tag labels for filters and results.
    pub properties_service: Arc<ToolPropertiesService>,
    /// Entity id of the chat this request belongs to, when the request is an
    /// interactive chat session. `None` for every other feature, in which case
    /// nothing is excluded.
    pub self_chat_id: Option<Uuid>,
}

impl FromRef<ToolServiceContext> for SearchToolContext {
    fn from_ref(ctx: &ToolServiceContext) -> Self {
        // `usage_context.entity` is set to the chat id for the Chat feature
        // (including subagents spawned from a chat, which inherit the feature).
        // Only treat it as a chat to exclude when the feature is actually Chat;
        // for other features the entity is some unrelated item.
        let self_chat_id = matches!(ctx.usage_context.feature, AiFeature::Chat)
            .then_some(ctx.usage_context.entity)
            .flatten();
        SearchToolContext {
            search_client: ctx.search_service_client.clone(),
            email_service: ctx.email_service.clone(),
            properties_service: ctx.properties_tool_context.service.clone(),
            self_chat_id,
        }
    }
}
