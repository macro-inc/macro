#![recursion_limit = "256"]

use activity::inbound::toolset::activity_toolset;
use ai_toolset::AsyncToolCollection;
use ai_toolset::schema::{FrontendSchemas, ToolSchemaGenerator, frontend_schemas_builder};

#[cfg(test)]
mod test;

mod build_context;
mod display_results;
mod schemas;
pub mod search;
mod search_tools;
mod self_knowledge;
pub mod serde_utils;
mod subagent;
mod tool_context;

pub use anthropic::toolset::AnthropicToolContext;
use anthropic::toolset::anthropic_toolset;
use bots::inbound::toolset::bot_toolset;
use calendar_events::inbound::toolset::{calendar_toolset, mcp_toolset as calendar_mcp_toolset};
use call::inbound::toolset::call_toolset;
use channels::inbound::toolset::channel_toolset;
use chat::inbound::toolset::chat_toolset;
use crm::inbound::toolset::crm_toolset;
use display_results::DisplayResults;
use documents::inbound::toolset::document_toolset;
use email::inbound::toolset::{email_toolset, mcp_toolset as email_mcp_toolset};
use import::inbound::toolset::import_toolset;
use notification::inbound::ai_tool::notification_toolset;
use projects::inbound::toolset::project_toolset;
use properties::inbound::toolset::properties_toolset;
use reminders::inbound::toolset::reminders_toolset;
use schemas::read;
use search_tools::{LoadTools, SearchTools};
use self_knowledge::SelfKnowledge;
use skills::inbound::toolset::skill_toolset;
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
    ChannelSideEffectClients, NoOpCallRtcClient, NoOpConnectionService, NoOpNotificationIngress,
    NoOpNotificationService, NoOpScheduleContext, NoOpSnsEndpointManager, NoOpTaskProperties,
    RequestContext, TaskPropertiesAdapter, ToolActivityToolContext, ToolBotEventBroker,
    ToolBotService, ToolBotToolContext, ToolCalendarMutationService, ToolCalendarReadService,
    ToolCalendarToolContext, ToolCallRecordQueryService, ToolCallService, ToolCallToolContext,
    ToolChannelEventDispatcher, ToolChannelMessagesService, ToolChannelToolContext,
    ToolChatService, ToolChatToolContext, ToolCommsService, ToolCrmService, ToolCrmToolContext,
    ToolDocumentService, ToolDocumentToolContext, ToolEmailService, ToolEmailToolContext,
    ToolEntityAccessManagementService, ToolEntityAccessService, ToolEntityCreator,
    ToolForeignEntityService, ToolFrecencyService, ToolImportService, ToolImportToolContext,
    ToolMcpSelector, ToolNotificationQueue, ToolNotificationService, ToolNotificationToolContext,
    ToolPipedreamConnection, ToolProjectService, ToolProjectToolContext, ToolPropertiesService,
    ToolPropertiesToolContext, ToolRemindersService, ToolRemindersToolContext, ToolServiceContext,
    ToolSkillService, ToolSkillToolContext, ToolSoupService, ToolSystemPropertiesService,
    ToolTeamService, ToolTeamToolContext, ToolUserEmailService, build_activity_tool_context,
    build_bot_tool_context, build_calendar_tool_context,
    build_channel_tool_context_with_dispatcher, build_channel_tool_context_with_side_effects,
    build_channel_tool_context_without_side_effects, build_crm_tool_context,
    build_project_tool_context, build_properties_service, build_properties_tool_context,
    build_reminders_tool_context, build_skill_tool_context, build_task_properties_adapter,
    build_team_repository, build_team_tool_context,
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
        .add_tool::<SelfKnowledge, ToolServiceContext>()
        .add_tool::<ListEntities, SoupToolContext<ToolSoupService, ToolEmailService>>()
        .add_subtoolset::<ToolActivityToolContext>(activity_toolset())
        .add_subtoolset::<ToolDocumentToolContext>(document_toolset())
        .add_subtoolset::<ToolProjectToolContext>(project_toolset())
        .add_subtoolset::<ToolPropertiesToolContext>(properties_toolset())
        .add_subtoolset::<ToolCallToolContext>(call_toolset())
        .add_subtoolset::<ToolChatToolContext>(chat_toolset())
        .add_subtoolset::<ToolChannelToolContext>(channel_toolset())
        .add_subtoolset::<ToolBotToolContext>(bot_toolset())
        .add_subtoolset::<ToolTeamToolContext>(team_toolset())
        .add_subtoolset::<ToolCrmToolContext>(crm_toolset())
        .add_subtoolset::<ToolSkillToolContext>(skill_toolset())
        .add_subtoolset::<AnthropicToolContext>(anthropic_toolset())
}

/// The host a toolset is assembled for.
///
/// Hosts differ on two axes. First, whether their surface can render the
/// composer card that finishes a chat-deferred user tool: only
/// [`AiHost::Chat`] can, so it alone registers `SendEmail` and the deferring
/// `CreateCalendarEvent` — on any other host those registrations would
/// return `PendingUserExecution` forever while reading to the model as
/// success. Second, whether the host runs the chat frontend's tool
/// discovery and display tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiHost {
    /// The AI chat, and any host whose conversation is stored as a chat the
    /// frontend can render (scheduled agents, agent sessions, memory
    /// generation): composer cards finish deferred user tools there.
    Chat,
    /// The channel-mention bot: no composer, so `CreateCalendarEvent`
    /// executes directly in the agent loop and `SendEmail` is omitted.
    ChannelBot,
    /// The MCP server: like [`AiHost::ChannelBot`] for user tools — MCP
    /// clients apply their own confirmation policy from tool annotations —
    /// and without the chat frontend's discovery/display tools.
    Mcp,
}

/// Assemble the toolset and tool-use prompt for a host. These are actually
/// sent to the AI provider.
pub fn tools_for(host: AiHost) -> ToolSetWithPrompt {
    let toolset = subagent_toolset()
        .add_subtoolset::<ToolNotificationToolContext>(notification_toolset())
        .add_subtoolset::<ToolRemindersToolContext>(reminders_toolset());
    let toolset = match host {
        AiHost::Chat => toolset
            .add_subtoolset::<ToolEmailToolContext>(email_toolset())
            .add_subtoolset::<ToolCalendarToolContext>(calendar_toolset()),
        AiHost::ChannelBot | AiHost::Mcp => toolset
            .add_subtoolset::<ToolEmailToolContext>(email_mcp_toolset())
            .add_subtoolset::<ToolCalendarToolContext>(calendar_mcp_toolset()),
    };
    let toolset = toolset
        .add_subtoolset::<ToolImportToolContext>(import_toolset())
        .add_tool::<Subagent, ToolServiceContext>();
    let toolset = match host {
        AiHost::Chat | AiHost::ChannelBot => toolset
            .add_tool::<SearchTools, ToolServiceContext>()
            .add_tool::<LoadTools, ToolServiceContext>()
            .add_tool::<DisplayResults, ToolServiceContext>(),
        AiHost::Mcp => toolset,
    };
    let prompt: Box<dyn std::fmt::Display + Send + Sync> = match host {
        AiHost::Chat => Box::new(&prompt::TOOL_USE_PROMPT),
        AiHost::ChannelBot | AiHost::Mcp => Box::new(&prompt::DIRECT_TOOL_USE_PROMPT),
    };
    ToolSetWithPrompt {
        toolset: Arc::new(toolset),
        prompt,
    }
}

/// Frontend typegen schemas with shared, deduplicated `$defs`.
///
/// These feed `gen_tool_schemas` / `generate-dcs-tools.ts` and are never
/// sent to AI providers.
pub fn all_tool_frontend_schemas() -> FrontendSchemas {
    frontend_schemas_builder()
        .merge(&tools_for(AiHost::Chat))
        .merge(&read::read_thread())
        .build()
}

pub fn no_tools() -> ToolSetWithPrompt {
    ToolSetWithPrompt {
        prompt: Box::new(&prompt::BASE_PROMPT),
        toolset: Arc::new(AsyncToolCollection::new()),
    }
}
