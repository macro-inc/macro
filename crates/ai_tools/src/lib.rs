#![recursion_limit = "256"]

use activity::inbound::toolset::activity_toolset;
use agent_session::inbound::toolset::coding_agent_toolset;
use ai_toolset::AsyncToolCollection;
use ai_toolset::schema::{FrontendSchemas, ToolSchemaGenerator, frontend_schemas_builder};

#[cfg(test)]
mod test;

pub mod ai_operations;
mod build_context;
mod deferred;
mod display_results;
mod import_channels;
mod mcp_app_catalog;
mod schemas;
pub mod search;
mod search_tools;
mod self_knowledge;
pub mod serde_utils;
mod subagent;
mod tool_context;
pub mod user_tool_review;

pub use anthropic::toolset::AnthropicToolContext;
use anthropic::toolset::anthropic_toolset;
use bots::inbound::toolset::bot_toolset;
use calendar_events::inbound::toolset::{calendar_toolset, mcp_toolset as calendar_mcp_toolset};
use calendar_scheduling::inbound::toolset::{
    booking_link_toolset, mcp_toolset as booking_link_mcp_toolset,
};
use call::inbound::toolset::call_toolset;
use channels::inbound::toolset::channel_toolset;
use chat::inbound::toolset::chat_toolset;
use crm::inbound::toolset::crm_toolset;
use databases::inbound::toolset::{databases_read_only_toolset, databases_toolset};
use databases_sql::toolset::{QueryDatabase, databases_sql_toolset};
use display_results::DisplayResults;
use documents::inbound::toolset::document_toolset;
use email::inbound::toolset::{email_toolset, mcp_toolset as email_mcp_toolset};
use import::inbound::toolset::import_toolset;
use initiative::inbound::toolset::initiative_toolset;
use notification::inbound::ai_tool::notification_toolset;
use projects::inbound::toolset::project_toolset;
use properties::inbound::toolset::properties_toolset;
use schemas::read;
use search_tools::{LoadTools, SearchTools};
use self_knowledge::SelfKnowledge;
use skills::inbound::toolset::skill_toolset;
use soup::inbound::toolset::{ListEntities, SoupToolContext};
use std::sync::Arc;
use subagent::{Subagent, SubagentContext};
use teams::inbound::toolset::team_toolset;

#[cfg(any(test, feature = "test-support"))]
pub use build_context::build_anthropic_tool_context_test;
pub use build_context::{
    build_anthropic_tool_context, build_image_generator_from_env,
    build_tool_service_context_from_env,
};
pub use deferred::{DeferredToolSet, deferred_tools};
pub use mcp_app_catalog::{PipedreamMcpAppCatalog, pipedream_client_from_env};
pub use search::search_toolset;
pub use tool_context::{
    ChannelSideEffectClients, MaybeToolEventBroker, NoOpCallRtcClient, NoOpConnectionService,
    NoOpNotificationIngress, NoOpNotificationService, NoOpSnsEndpointManager, NoOpTaskProperties,
    RequestContext, RoutineToolContext, TaskPropertiesAdapter, ToolActivityToolContext,
    ToolBookingLinkService, ToolBookingLinkToolContext, ToolBotService, ToolBotToolContext,
    ToolCalendarMutationService, ToolCalendarReadService, ToolCalendarToolContext,
    ToolCallRecordQueryService, ToolCallService, ToolCallToolContext, ToolChannelEventDispatcher,
    ToolChannelMessagesService, ToolChannelToolContext, ToolChatService, ToolChatToolContext,
    ToolCodingAgentToolContext, ToolCommsService, ToolCrmService, ToolCrmToolContext,
    ToolDatabasesService, ToolDatabasesSqlToolContext, ToolDatabasesToolContext,
    ToolDocumentService, ToolDocumentToolContext, ToolEmailService, ToolEmailToolContext,
    ToolEntityAccessManagementService, ToolEntityAccessService, ToolEntityCreator,
    ToolForeignEntityService, ToolFrecencyService, ToolGithubPullRequestService,
    ToolImageGenerationToolContext, ToolImportService, ToolImportToolContext,
    ToolInitiativeToolContext, ToolMcpSelector, ToolNotificationQueue, ToolNotificationService,
    ToolNotificationToolContext, ToolPipedreamConnection, ToolProjectService,
    ToolProjectToolContext, ToolPropertiesService, ToolPropertiesToolContext, ToolServiceContext,
    ToolSkillService, ToolSkillToolContext, ToolSoupService, ToolSystemPropertiesService,
    ToolTableEventPublisher, ToolTeamService, ToolTeamToolContext, ToolUserEmailService,
    ToolViewOnlyDatabasesSqlToolContext, build_activity_tool_context,
    build_booking_link_tool_context, build_bot_tool_context, build_calendar_tool_context,
    build_channel_tool_context_with_dispatcher, build_channel_tool_context_with_side_effects,
    build_channel_tool_context_without_side_effects, build_coding_agent_tool_context,
    build_crm_tool_context, build_databases_sql_tool_context, build_databases_tool_context,
    build_image_generation_tool_context, build_initiative_tool_context,
    build_message_service_with_side_effects, build_message_service_without_side_effects,
    build_project_tool_context, build_properties_service, build_properties_service_with_broker,
    build_properties_tool_context, build_routine_tool_context, build_skill_tool_context,
    build_task_properties_adapter, build_team_repository, build_team_tool_context,
};
#[cfg(any(test, feature = "test-support"))]
pub use tool_context::{build_image_generation_tool_context_test, no_op_schedule_context};
pub type AiToolSet = AsyncToolCollection<ToolServiceContext>;

/// Database-only capabilities for the in-app database assistant. This excludes
/// connectors and unrelated tools such as messaging and email.
pub fn database_tools() -> AiToolSet {
    AsyncToolCollection::new()
        .add_subtoolset::<ToolDatabasesToolContext>(databases_toolset())
        .add_subtoolset::<ToolDatabasesSqlToolContext>(databases_sql_toolset())
}

/// Discovery and QueryDatabase for live document answers. The SQL tool is
/// the one every host gets; here it runs over access capped at view, so the
/// access check refuses its writes even for a user who could edit.
pub fn database_read_only_tools() -> AiToolSet {
    AsyncToolCollection::new()
        .add_subtoolset::<ToolDatabasesToolContext>(databases_read_only_toolset())
        .add_tool::<QueryDatabase, ToolViewOnlyDatabasesSqlToolContext>()
}

pub struct ToolSetWithPrompt {
    pub toolset: Arc<AiToolSet>,
    pub prompt: Box<dyn std::fmt::Display + Send + Sync>,
    /// The tools a [`DeferredToolSet`] keeps out of every request; the prompt
    /// lists them. Empty on hosts that send every schema.
    pub deferred: Arc<[ai_toolset::SearchableTool]>,
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
        .add_subtoolset::<ToolImageGenerationToolContext>(
            image_generation::inbound::toolset::image_generation_toolset(),
        )
        .add_subtoolset::<ToolProjectToolContext>(project_toolset())
        .add_subtoolset::<ToolInitiativeToolContext>(initiative_toolset())
        .add_subtoolset::<ToolPropertiesToolContext>(properties_toolset())
        .add_subtoolset::<ToolCallToolContext>(call_toolset())
        .add_subtoolset::<ToolChatToolContext>(chat_toolset())
        .add_subtoolset::<ToolChannelToolContext>(channel_toolset())
        .add_subtoolset::<ToolBotToolContext>(bot_toolset())
        .add_subtoolset::<ToolTeamToolContext>(team_toolset())
        .add_subtoolset::<ToolCrmToolContext>(crm_toolset())
        .add_subtoolset::<ToolDatabasesToolContext>(databases_toolset())
        .add_subtoolset::<ToolDatabasesSqlToolContext>(databases_sql_toolset())
        .add_subtoolset::<ToolSkillToolContext>(skill_toolset())
        .add_subtoolset::<AnthropicToolContext>(anthropic_toolset())
}

/// The host a toolset is assembled for.
///
/// Hosts differ on two axes. First, whether something finishes a deferred
/// user tool for them: [`AiHost::Chat`] has the composer card after the
/// turn and [`AiHost::AgentSession`] the review elicitation in it, so those
/// two register `SendEmail` and the deferring `CreateCalendarEvent` — on any
/// other host those registrations would return `PendingUserExecution`
/// forever while reading to the model as success. Second, whether the host
/// supports tool discovery and can render tool-call views. Channel bots keep
/// discovery, but only chat and agent-session transcripts render rich views.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiHost {
    /// The AI chat, and any host whose conversation is stored as a chat the
    /// frontend can render (scheduled agents, memory generation): composer
    /// cards finish deferred user tools there, after the turn.
    Chat,
    /// Macro's in-process agent serving an agent session: the same toolset
    /// as [`AiHost::Chat`], but its user tools are reviewed in the turn - the
    /// agent loop's finisher puts the call to the user over ACP and the tool
    /// returns the outcome - so the prompt describes a review card the agent
    /// waits on, never a pending composer.
    AgentSession,
    /// The channel-mention bot: no composer, so `CreateCalendarEvent`
    /// executes directly in the agent loop and `SendEmail` is omitted. Replies
    /// contain text only, so this host also omits `DisplayResults`.
    ChannelBot,
    /// The MCP server: like [`AiHost::ChannelBot`] for user tools — MCP
    /// clients apply their own confirmation policy from tool annotations —
    /// and without the chat frontend's discovery/display tools.
    Mcp,
}

/// The tools whose schemas go out with every request on hosts with tool
/// search: the ones most turns use. Every other tool is deferred (see
/// [`DeferredToolSet`]), listed by name and summary in the prompt and loaded
/// with `LoadTools` when needed.
pub const EAGER_TOOLS: &[&str] = &[
    "BashCodeExecution",
    "ContentSearch",
    "CreateDocument",
    "DisplayResults",
    "EditDocument",
    "GetThread",
    "ListEntities",
    "ListSkills",
    "LoadTools",
    "NameSearch",
    "ReadChannelMessageContext",
    "ReadChannelMessages",
    "ReadChannelThread",
    "ReadChat",
    "ReadContent",
    "ReadMetadata",
    "ReadSkill",
    "SearchSkills",
    "SearchTools",
    "SelfKnowledge",
    "SendChannelMessage",
    "Subagent",
    "TextEditorCodeExecution",
    "WebFetch",
    "WebSearch",
];

/// Assemble the toolset and tool-use prompt for a host. These are actually
/// sent to the AI provider.
pub fn tools_for(host: AiHost) -> ToolSetWithPrompt {
    let toolset = subagent_toolset()
        .add_subtoolset::<ToolNotificationToolContext>(notification_toolset())
        .add_subtoolset::<RoutineToolContext>(routines::inbound::routine_toolset());
    let toolset = match host {
        AiHost::Chat | AiHost::AgentSession => toolset
            .add_subtoolset::<ToolEmailToolContext>(email_toolset())
            .add_subtoolset::<ToolCalendarToolContext>(calendar_toolset())
            .add_subtoolset::<ToolBookingLinkToolContext>(booking_link_toolset()),
        AiHost::ChannelBot | AiHost::Mcp => toolset
            .add_subtoolset::<ToolEmailToolContext>(email_mcp_toolset())
            .add_subtoolset::<ToolCalendarToolContext>(calendar_mcp_toolset())
            .add_subtoolset::<ToolBookingLinkToolContext>(booking_link_mcp_toolset()),
    };
    let toolset = toolset
        .add_subtoolset::<ToolImportToolContext>(import_toolset())
        .add_subtoolset::<ToolCodingAgentToolContext>(coding_agent_toolset())
        .add_tool::<Subagent, SubagentContext>();
    let toolset = match host {
        AiHost::Chat | AiHost::AgentSession | AiHost::ChannelBot => toolset
            .add_tool::<SearchTools, ToolServiceContext>()
            .add_tool::<LoadTools, ToolServiceContext>(),
        AiHost::Mcp => toolset,
    };
    let toolset = match host {
        AiHost::Chat | AiHost::AgentSession => {
            toolset.add_tool::<DisplayResults, ToolServiceContext>()
        }
        AiHost::ChannelBot | AiHost::Mcp => toolset,
    };
    // External MCP clients have no `LoadTools`, so they get every schema.
    let deferred = match host {
        AiHost::Chat | AiHost::AgentSession | AiHost::ChannelBot => {
            deferred_tools(&toolset, EAGER_TOOLS)
        }
        AiHost::Mcp => Arc::from([]),
    };
    let prompt: Box<dyn std::fmt::Display + Send + Sync> = match host {
        AiHost::Chat => Box::new(prompt::TOOL_USE_PROMPT.compose(&prompt::coding_agents::PROMPT)),
        AiHost::AgentSession => {
            Box::new(prompt::SESSION_TOOL_USE_PROMPT.compose(&prompt::coding_agents::PROMPT))
        }
        AiHost::ChannelBot | AiHost::Mcp => {
            Box::new(prompt::DIRECT_TOOL_USE_PROMPT.compose(&prompt::coding_agents::PROMPT))
        }
    };
    let catalog: Vec<(&str, &str)> = deferred
        .iter()
        .map(|tool| (tool.name.as_str(), tool.description.as_str()))
        .collect();
    let prompt: Box<dyn std::fmt::Display + Send + Sync> =
        match prompt::deferred_tools::render(&catalog) {
            Some(section) => Box::new(format!("{prompt}{section}")),
            None => prompt,
        };
    ToolSetWithPrompt {
        toolset: Arc::new(toolset),
        prompt,
        deferred,
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
        deferred: Arc::from([]),
    }
}
