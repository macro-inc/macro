#![recursion_limit = "256"]

use agent_session::inbound::toolset::{ReadAgentSession, coding_agent_toolset};
use ai_toolset::AsyncToolCollection;
mod frontend_compat;

use ai_toolset::schema::{FrontendSchemas, ToolSchemaGenerator, frontend_schemas_builder};

#[cfg(test)]
mod test;

mod build_context;
pub mod crm_csv_files;
mod deferred;
mod display_results;
pub mod email_attachments;
mod import_channels;
mod import_jobs;
mod import_trackers;
mod import_workspace;
mod mcp_app_catalog;
pub mod memory;
mod schemas;
pub mod search;
mod search_tools;
mod self_knowledge;
pub mod serde_utils;
mod tool_context;
pub mod user_tool_review;

pub use anthropic::toolset::AnthropicToolContext;
use anthropic::toolset::anthropic_toolset;
use bots::inbound::toolset::bot_toolset;
use calendar_events::inbound::team_toolset::team_calendar_toolset;
use calendar_events::inbound::toolset::{calendar_toolset, mcp_toolset as calendar_mcp_toolset};
use calendar_scheduling::inbound::toolset::{
    booking_link_toolset, booking_management_toolset, mcp_toolset as booking_link_mcp_toolset,
};
use call::inbound::toolset::call_toolset;
use channels::inbound::toolset::channel_toolset;
use cognition::inbound::toolset::cognition_toolset;
use crm::inbound::toolset::{crm_toolset, pipelines::pipeline_toolset};
use databases::inbound::toolset::{databases_read_only_toolset, databases_toolset};
use databases_sql::toolset::{QueryDatabase, databases_sql_toolset};
use display_results::DisplayResults;
use documents::inbound::toolset::document_toolset;
use email::inbound::toolset::{email_toolset, mcp_toolset as email_mcp_toolset};
use favorites::inbound::toolset::favorites_toolset;
use import::inbound::toolset::import_toolset;
use initiative::inbound::toolset::initiative_toolset;
use mcp_client::inbound::toolset::mcp_server_toolset;
use messages::inbound::toolset::message_toolset;
use notification::inbound::ai_tool::{item_notification_preference_toolset, notification_toolset};
use projects::inbound::toolset::project_toolset;
use properties::inbound::toolset::properties_toolset;
use schemas::read;
use search_tools::{LoadTools, SearchTools};
use self_knowledge::SelfKnowledge;
use skills::inbound::toolset::skill_toolset;
use soup::inbound::toolset::{ListEntities, SoupToolContext};
use std::sync::Arc;
use teams::inbound::toolset::team_toolset;

#[cfg(any(test, feature = "test-support"))]
pub use build_context::build_anthropic_tool_context_test;
pub use build_context::{
    build_anthropic_tool_context, build_cognition_tool_context, build_image_generator_from_env,
    build_tool_service_context_from_env, build_web_search_provider_from_env,
};
pub use deferred::{DeferredToolSet, deferred_tools};
pub use import_jobs::{IMPORT_JOBS_HANDOVER_TIMEOUT, ImportJobs};
pub use mcp_app_catalog::{
    PipedreamMcpAppCatalog, canvas_artifacts_rollout, canvas_artifacts_rollout_from_env,
    connect_adapter, connector_backends_from_env, macro_connect_rollout, pipedream_client_from_env,
};
pub use search::search_toolset;
pub use tool_context::{
    ChannelSideEffectClients, FormsToolConfig, MaybeToolEventBroker, NoOpCallRtcClient,
    NoOpConnectionService, NoOpNotificationIngress, NoOpNotificationService,
    NoOpSnsEndpointManager, NoOpTaskProperties, RequestContext, RoutineToolContext,
    TaskPropertiesAdapter, ToolActivityReadService, ToolBookingLinkService,
    ToolBookingLinkToolContext, ToolBookingManagementToolContext, ToolBotService,
    ToolBotToolContext, ToolCalendarMutationService, ToolCalendarReadService,
    ToolCalendarToolContext, ToolCallRecordQueryService, ToolCallService, ToolCallToolContext,
    ToolChannelEventDispatcher, ToolChannelMediaUploadToolContext, ToolChannelMessagesService,
    ToolChannelToolContext, ToolChatService, ToolChatToolContext, ToolCodingAgentToolContext,
    ToolCognitionToolContext, ToolCommsService, ToolCrmService, ToolCrmToolContext,
    ToolCrmTransferService, ToolCrmTransferToolContext, ToolDatabasesService,
    ToolDatabasesSqlToolContext, ToolDatabasesToolContext, ToolDocumentService,
    ToolDocumentToolContext, ToolEmailService, ToolEmailToolContext,
    ToolEntityAccessManagementService, ToolEntityAccessService, ToolEntityCreator,
    ToolFavoritesService, ToolFavoritesToolContext, ToolForeignEntityService, ToolFormsToolContext,
    ToolFrecencyService, ToolGithubPullRequestService, ToolImageGenerationToolContext,
    ToolImportService, ToolImportToolContext, ToolInitiativeToolContext,
    ToolItemNotificationPreferenceToolContext, ToolMcpSelector, ToolMcpServerToolContext,
    ToolMessageToolContext, ToolNotificationQueue, ToolNotificationService,
    ToolNotificationToolContext, ToolPipedreamConnection, ToolPipelineService,
    ToolPipelineToolContext, ToolPipelineWorkflows, ToolProjectService, ToolProjectToolContext,
    ToolPropertiesService, ToolPropertiesToolContext, ToolReadAgentSessionContext,
    ToolServiceContext, ToolSkillService, ToolSkillToolContext, ToolSoupService,
    ToolSystemPropertiesService, ToolTableEventPublisher, ToolTeamCalendarService,
    ToolTeamCalendarToolContext, ToolTeamService, ToolTeamToolContext, ToolUserEmailService,
    ToolViewOnlyDatabasesSqlToolContext, build_activity_read_service,
    build_booking_link_tool_context, build_booking_management_tool_context, build_bot_tool_context,
    build_calendar_tool_context, build_channel_media_upload_tool_context,
    build_channel_tool_context_with_dispatcher, build_channel_tool_context_with_side_effects,
    build_channel_tool_context_without_side_effects, build_coding_agent_tool_context,
    build_crm_tool_context, build_crm_transfer_tool_context, build_databases_sql_tool_context,
    build_databases_tool_context, build_favorites_service, build_favorites_tool_context,
    build_forms_tool_context, build_image_generation_tool_context, build_import_repo,
    build_initiative_tool_context, build_item_notification_preference_tool_context,
    build_message_service_with_side_effects, build_message_service_without_side_effects,
    build_message_tool_context, build_pipeline_tool_context, build_project_tool_context,
    build_properties_service, build_properties_service_with_broker, build_properties_tool_context,
    build_read_agent_session_context, build_routine_tool_context, build_skill_tool_context,
    build_task_properties_adapter, build_team_calendar_tool_context, build_team_repository,
    build_team_tool_context,
};
pub use tool_context::{ToolConnectorToolContext, build_connector_tool_context};
#[cfg(any(test, feature = "test-support"))]
pub use tool_context::{
    build_channel_media_upload_tool_context_test, build_image_generation_tool_context_test,
    no_op_schedule_context,
};
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
    /// The prompt with how each area of Macro works inline, generated from the
    /// SDK's `@agent` guidance.
    pub prompt: Box<dyn std::fmt::Display + Send + Sync>,
    /// The prompt for turns that route SDK entities, whose selected entities
    /// bring their guidance into the turn; [`Self::prompt`] on hosts that do
    /// not route.
    pub routed_prompt: Box<dyn std::fmt::Display + Send + Sync>,
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

/// The tools every host shares, before host-specific email, calendar and
/// discovery tools are added.
pub(crate) fn base_toolset() -> AiToolSet {
    AsyncToolCollection::new()
        .add_toolset(search_toolset())
        .add_tool::<SelfKnowledge, ToolServiceContext>()
        .add_tool::<ListEntities, SoupToolContext<ToolSoupService, ToolEmailService>>()
        .add_subtoolset::<ToolDocumentToolContext>(document_toolset())
        .add_subtoolset::<ToolImageGenerationToolContext>(
            image_generation::inbound::toolset::image_generation_toolset(),
        )
        .add_subtoolset::<ToolCognitionToolContext>(cognition_toolset())
        .add_subtoolset::<ToolProjectToolContext>(project_toolset())
        .add_subtoolset::<ToolFavoritesToolContext>(favorites_toolset())
        .add_subtoolset::<ToolMessageToolContext>(message_toolset())
        .add_subtoolset::<ToolInitiativeToolContext>(initiative_toolset())
        .add_subtoolset::<ToolPropertiesToolContext>(properties_toolset())
        .add_subtoolset::<ToolCallToolContext>(call_toolset())
        .add_tool::<ReadAgentSession, ToolReadAgentSessionContext>()
        .add_tool::<agent_session::inbound::toolset::ReadAgentSessionSharing, ToolReadAgentSessionContext>()
        .add_tool::<agent_session::inbound::toolset::UpdateAgentSessionSharing, ToolReadAgentSessionContext>()
        .add_subtoolset::<ToolChannelToolContext>(channel_toolset())
        .add_subtoolset::<ToolBotToolContext>(bot_toolset())
        .add_subtoolset::<ToolTeamToolContext>(team_toolset())
        .add_subtoolset::<ToolCrmToolContext>(crm_toolset())
        .add_subtoolset::<ToolPipelineToolContext>(pipeline_toolset())
        .add_subtoolset::<ToolCrmTransferToolContext>(
            crm::inbound::toolset::transfer::crm_transfer_toolset(),
        )
        .add_subtoolset::<ToolDatabasesToolContext>(databases_toolset())
        .add_subtoolset::<ToolFormsToolContext>(forms::inbound::toolset::authoring_toolset())
        .add_subtoolset::<ToolDatabasesSqlToolContext>(databases_sql_toolset())
        .add_subtoolset::<ToolSkillToolContext>(skill_toolset())
        .add_subtoolset::<AnthropicToolContext>(anthropic_toolset())
        .add_subtoolset::<web_search::inbound::toolset::WebToolContext>(
            web_search::inbound::toolset::web_toolset(),
        )
}

/// A direct-tool host a toolset is assembled for. Agent sessions run code
/// mode and get [`tools_for_agent_code_mode`] instead.
///
/// Hosts differ on two axes. First, whether something finishes a deferred
/// user tool for them: only [`AiHost::Chat`] has a composer card after the
/// turn, so only it registers `SendEmail` and the deferring
/// `CreateCalendarEvent` — on any other host those registrations would
/// return `PendingUserExecution` forever while reading to the model as
/// success. Second, whether the host supports tool discovery and can render
/// tool-call views. Channel bots keep discovery, but only chat transcripts
/// render rich views.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiHost {
    /// The AI chat, and any host whose conversation is stored as a chat the
    /// frontend can render (scheduled agents, memory generation): composer
    /// cards finish deferred user tools there, after the turn.
    Chat,
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
    "ReadAgentSession",
    "ReadChannelMessages",
    "ReadChannelThread",
    "ReadContent",
    "ReadMetadata",
    "ReadSkill",
    "SearchSkills",
    "SearchTools",
    "SelfKnowledge",
    "SendChannelMessage",
    "ShareWithChannel",
    "TextEditorCodeExecution",
    "WebFetch",
    "WebSearch",
];

/// Assemble the toolset and tool-use prompt for a host. These are actually
/// sent to the AI provider.
pub fn tools_for(host: AiHost) -> ToolSetWithPrompt {
    let toolset = base_toolset()
        .add_subtoolset::<memory::ToolMemoryContext>(::memory::inbound::toolset::memory_toolset())
        .add_subtoolset::<ToolBookingManagementToolContext>(booking_management_toolset())
        .add_subtoolset::<ToolNotificationToolContext>(notification_toolset())
        .add_subtoolset::<ToolItemNotificationPreferenceToolContext>(
            item_notification_preference_toolset(),
        )
        .add_subtoolset::<ToolTeamCalendarToolContext>(team_calendar_toolset())
        .add_subtoolset::<RoutineToolContext>(routines::inbound::routine_toolset());
    let toolset = match host {
        AiHost::Chat => toolset
            .add_subtoolset::<ToolEmailToolContext>(email_toolset())
            .add_subtoolset::<ToolCalendarToolContext>(calendar_toolset())
            .add_subtoolset::<ToolBookingLinkToolContext>(booking_link_toolset()),
        AiHost::ChannelBot | AiHost::Mcp => toolset
            .add_subtoolset::<ToolEmailToolContext>(email_mcp_toolset())
            .add_subtoolset::<ToolCalendarToolContext>(calendar_mcp_toolset())
            .add_subtoolset::<ToolBookingLinkToolContext>(booking_link_mcp_toolset()),
    };
    let toolset = toolset
        .add_tool::<forms::inbound::toolset::SetFormAccess, ToolFormsToolContext>()
        .add_subtoolset::<ToolImportToolContext>(import_toolset())
        .add_subtoolset::<ToolCodingAgentToolContext>(coding_agent_toolset());
    // Only Macro's own agents connect servers for the user.
    let toolset = match host {
        AiHost::Chat => toolset.add_subtoolset::<ToolMcpServerToolContext>(mcp_server_toolset::<
            mcp_client::outbound::NativeServerStore,
        >()),
        AiHost::ChannelBot | AiHost::Mcp => toolset,
    };
    let toolset = match host {
        AiHost::Chat | AiHost::ChannelBot => toolset
            .add_tool::<SearchTools, ToolServiceContext>()
            .add_tool::<LoadTools, ToolServiceContext>(),
        AiHost::Mcp => toolset,
    };
    let toolset = match host {
        AiHost::Chat => toolset.add_tool::<DisplayResults, ToolServiceContext>(),
        AiHost::ChannelBot | AiHost::Mcp => toolset,
    };
    // A direct upload needs a client that can PUT the bytes itself; in-app
    // hosts have no network-capable shell, so only MCP clients get it.
    let toolset = match host {
        AiHost::Mcp => toolset.add_tool::<
            channels::inbound::toolset::CreateChannelMediaUpload,
            ToolChannelMediaUploadToolContext,
        >(),
        AiHost::Chat | AiHost::ChannelBot => toolset,
    };
    // External MCP clients have no `LoadTools`, so they get every schema.
    let deferred = match host {
        AiHost::Chat | AiHost::ChannelBot => deferred_tools(&toolset, EAGER_TOOLS),
        AiHost::Mcp => Arc::from([]),
    };
    let tools_prompt = match host {
        AiHost::Chat => prompt::TOOL_USE_PROMPT
            .compose(&prompt::coding_agents::PROMPT)
            .to_string(),
        AiHost::ChannelBot | AiHost::Mcp => prompt::DIRECT_TOOL_USE_PROMPT
            .compose(&prompt::coding_agents::PROMPT)
            .to_string(),
    };
    let guides = agent_code_mode::domain::inline_guides(agent_code_mode::domain::GuideHost::Direct);
    let deferred_section = deferred_section(&deferred);
    let prompt = format!("{tools_prompt}{guides}{deferred_section}");
    ToolSetWithPrompt {
        toolset: Arc::new(toolset),
        routed_prompt: Box::new(prompt.clone()),
        prompt: Box::new(prompt),
        deferred,
    }
}

/// The native tools an agent session's code-mode turn gets beside
/// `ExecuteCode`: only what a program cannot do through the Macro SDK.
///
/// - `RenderCanvas`: an `ExecuteCode` result cannot carry the image it renders.
/// - `ListAgentUpdates`: its result renders the cards the user answers on.
/// - `IssueBotCredential`: its card mints the secret without the model
///   reading it.
/// - `ListCompanies`: `macro.crm.searchCompanies()` has no stage or owner
///   filter.
/// - `ImportFromNotion`, `ImportFromLinear`, `ImportFromJira`: they stage the
///   plan an import review presents.
/// - `SelfKnowledge`, the Anthropic code-execution tools, and `SearchTools`
///   / `LoadTools`, which also load the session's connected MCP tools.
pub fn tools_for_agent_code_mode() -> ToolSetWithPrompt {
    let toolset = AsyncToolCollection::new()
        .add_tool::<SelfKnowledge, ToolServiceContext>()
        .add_tool::<documents::inbound::toolset::RenderCanvas, ToolDocumentToolContext>()
        .add_tool::<agent_session::inbound::toolset::ListAgentUpdates, ToolCodingAgentToolContext>()
        .add_tool::<bots::inbound::toolset::IssueBotCredential, ToolBotToolContext>()
        .add_tool::<crm::inbound::toolset::ListCompanies, ToolCrmToolContext>()
        .add_tool::<import::inbound::toolset::ImportFromNotion, ToolImportToolContext>()
        .add_tool::<import::inbound::toolset::ImportFromLinear, ToolImportToolContext>()
        .add_tool::<import::inbound::toolset::ImportFromJira, ToolImportToolContext>()
        .add_subtoolset::<AnthropicToolContext>(anthropic_toolset())
        .add_tool::<SearchTools, ToolServiceContext>()
        .add_tool::<LoadTools, ToolServiceContext>();
    let deferred = deferred_tools(&toolset, EAGER_TOOLS);
    use agent_code_mode::domain::{GuideHost, inline_guides};
    let tools_prompt = prompt::CODE_MODE_SESSION_TOOL_USE_PROMPT.to_string();
    let guides = inline_guides(GuideHost::Code);
    let deferred_section = deferred_section(&deferred);
    // Turns that route SDK entities bring their selected entities' guidance
    // in themselves.
    ToolSetWithPrompt {
        toolset: Arc::new(toolset),
        prompt: Box::new(format!("{tools_prompt}{guides}{deferred_section}")),
        routed_prompt: Box::new(format!("{tools_prompt}{deferred_section}")),
        deferred,
    }
}

/// The user tools a code-mode review runs by name once the user approves
/// it. No host advertises this toolset to a model.
pub fn code_mode_tools() -> Arc<AiToolSet> {
    Arc::new(
        AsyncToolCollection::new()
            .add_user_tool::<email::inbound::toolset::SendEmail, ToolEmailToolContext>()
            .add_user_tool::<calendar_events::inbound::toolset::CreateCalendarEvent, ToolCalendarToolContext>(),
    )
}

/// The prompt section listing deferred tools by name and summary.
fn deferred_section(deferred: &[ai_toolset::SearchableTool]) -> String {
    let catalog: Vec<(&str, &str)> = deferred
        .iter()
        .map(|tool| (tool.name.as_str(), tool.description.as_str()))
        .collect();
    prompt::deferred_tools::render(&catalog).unwrap_or_default()
}

/// Frontend typegen schemas with shared, deduplicated `$defs`.
///
/// These feed `gen_tool_schemas` / `generate-dcs-tools.ts` and are never
/// sent to AI providers.
pub fn all_tool_frontend_schemas() -> FrontendSchemas {
    frontend_schemas_builder()
        .merge(&tools_for(AiHost::Chat))
        .merge(&tools_for_agent_code_mode())
        .merge(&agent_code_mode::inbound::toolset::toolset())
        // Persisted legacy calls still render, but are never executable or advertised.
        .merge(&chat::inbound::toolset::chat_toolset::<
            ToolChatService,
            ToolEntityAccessService,
        >())
        .merge(&read::read_thread())
        .merge(&schemas::subagent::subagent())
        .merge(&schemas::read_activity::read_activity())
        .merge(&schemas::discover_connectors::discover_connectors())
        .merge(&frontend_compat::LegacyConversationSchemas)
        .build()
}

pub fn no_tools() -> ToolSetWithPrompt {
    ToolSetWithPrompt {
        prompt: Box::new(&prompt::BASE_PROMPT),
        routed_prompt: Box::new(&prompt::BASE_PROMPT),
        toolset: Arc::new(AsyncToolCollection::new()),
        deferred: Arc::from([]),
    }
}
