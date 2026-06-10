#![recursion_limit = "256"]

use ai_toolset::AsyncToolCollection;
use ai_toolset::schema::{FrontendSchemas, ToolSchemaGenerator, frontend_schemas_builder};
mod build_context;
mod schemas;
pub mod search;
pub mod serde_utils;
mod subagent;
mod tool_context;

pub use anthropic::toolset::AnthropicToolContext;
use anthropic::toolset::anthropic_toolset;
use call::inbound::toolset::call_toolset;
use channels::inbound::toolset::channel_toolset;
use chat::inbound::toolset::chat_toolset;
use documents::inbound::toolset::document_toolset;
use email::inbound::toolset::{email_toolset, mcp_toolset as email_mcp_toolset};
use notification::inbound::ai_tool::notification_toolset;
use properties::inbound::toolset::properties_toolset;
use schemas::read;
use soup::inbound::toolset::{ListEntities, SoupToolContext};
use std::sync::Arc;
use subagent::Subagent;
use teams::inbound::toolset::team_toolset;

#[cfg(any(test, feature = "test-support"))]
pub use build_context::build_anthropic_tool_context_test;
pub use build_context::{build_anthropic_tool_context, build_tool_service_context_from_env};
pub use search::search_toolset;
#[cfg(any(test, feature = "test-support"))]
pub use tool_context::no_op_schedule_context;
pub use tool_context::{
    NoOpCallRtcClient, NoOpConnectionService, NoOpNotificationIngress, NoOpNotificationService,
    NoOpScheduleContext, NoOpSnsEndpointManager, NoOpTaskProperties, RequestContext,
    TaskPropertiesAdapter, ToolCallRecordQueryService, ToolCallService, ToolCallToolContext,
    ToolChannelMessagesService, ToolChannelToolContext, ToolChatService, ToolChatToolContext,
    ToolCommsService, ToolDocumentService, ToolDocumentToolContext, ToolEmailService,
    ToolEmailToolContext, ToolEntityAccessManagementService, ToolEntityAccessService,
    ToolForeignEntityService, ToolFrecencyService, ToolNotificationQueue, ToolNotificationService,
    ToolNotificationToolContext, ToolPropertiesService, ToolPropertiesToolContext,
    ToolServiceContext, ToolSoupService, ToolSystemPropertiesService, ToolTeamService,
    ToolTeamToolContext, ToolUserEmailService, build_channel_tool_context,
    build_properties_service, build_properties_tool_context, build_task_properties_adapter,
    build_team_tool_context,
};
pub type AiToolSet = AsyncToolCollection<ToolServiceContext>;

pub struct ToolSetWithPrompt {
    pub toolset: Arc<AiToolSet>,
    pub prompt: Box<dyn std::fmt::Display + Send + Sync>,
}

impl ToolSchemaGenerator for ToolSetWithPrompt {
    fn register_schemas(
        &self,
        generator: &mut schemars::SchemaGenerator,
    ) -> Vec<ai_toolset::schema::FrontendToolEntry> {
        self.toolset.register_schemas(generator)
    }
}

/// Toolset available to subagents — everything except email and the Subagent
/// tool itself (subagents cannot create subagents).
pub(crate) fn subagent_toolset() -> AiToolSet {
    AsyncToolCollection::new()
        .add_toolset(search_toolset())
        .add_tool::<ListEntities, SoupToolContext<ToolSoupService, ToolEmailService>>()
        .add_subtoolset::<ToolDocumentToolContext>(document_toolset())
        .add_subtoolset::<ToolPropertiesToolContext>(properties_toolset())
        .add_subtoolset::<ToolCallToolContext>(call_toolset())
        .add_subtoolset::<ToolChatToolContext>(chat_toolset())
        .add_subtoolset::<ToolChannelToolContext>(channel_toolset())
        .add_subtoolset::<ToolTeamToolContext>(team_toolset())
        .add_subtoolset::<AnthropicToolContext>(anthropic_toolset())
}

/// These are actually sent to the AI provider
pub fn all_tools() -> ToolSetWithPrompt {
    let toolset = subagent_toolset()
        .add_subtoolset::<ToolNotificationToolContext>(notification_toolset())
        .add_subtoolset::<ToolEmailToolContext>(email_toolset())
        .add_tool::<Subagent, ToolServiceContext>();
    let toolset = Arc::new(toolset);
    ToolSetWithPrompt {
        toolset,
        prompt: Box::new(&prompt::TOOL_USE_PROMPT),
    }
}

/// Frontend typegen schemas with shared, deduplicated `$defs`.
///
/// These feed `gen_tool_schemas` / `generate-dcs-tools.ts` and are never
/// sent to AI providers.
pub fn all_tool_frontend_schemas() -> FrontendSchemas {
    frontend_schemas_builder()
        .merge(&all_tools())
        .merge(&read::read_thread())
        .build()
}

/// Toolset for the MCP server — excludes SendEmail.
pub fn mcp_tools() -> ToolSetWithPrompt {
    let toolset = subagent_toolset()
        .add_subtoolset::<ToolNotificationToolContext>(notification_toolset())
        .add_subtoolset::<ToolEmailToolContext>(email_mcp_toolset())
        .add_tool::<Subagent, ToolServiceContext>();
    let toolset = Arc::new(toolset);
    ToolSetWithPrompt {
        toolset,
        prompt: Box::new(&prompt::TOOL_USE_PROMPT),
    }
}

pub fn no_tools() -> ToolSetWithPrompt {
    ToolSetWithPrompt {
        prompt: Box::new(&prompt::BASE_PROMPT),
        toolset: Arc::new(AsyncToolCollection::new()),
    }
}
