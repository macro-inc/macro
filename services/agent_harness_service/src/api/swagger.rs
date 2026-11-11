//! OpenAPI document for the agent harness service's session routes.

use agent_changes::inbound::axum_router::{
    self as changes_router, AgentSessionChangesPatchResponse, AgentSessionChangesResponse,
    CaptureAttemptDto, CaptureOutcomeDto, ChangedFileDto, ChangesetDto, ChangesetSourceDto,
    FileChangeKindDto, GitRefDto,
};
use agent_harness::domain::mode_choice::AgentMode;
use agent_harness::inbound::app_connections::{self, AppConnectedRequest};
use agent_harness::inbound::capability_discovery;
use agent_harness::inbound::mode_choice::{self, AgentModeChoiceRequest, AgentModeChoiceResponse};
use agent_harness::inbound::model_load::{
    self, AgentModelDto, AgentModelsStatusDto, LoadAgentModelsRequest, LoadAgentModelsResponse,
    ModelHarnessDto,
};
use agent_harness::inbound::repositories::{
    self, AgentRepositoriesResponse, AgentRepositoryBranchesResponse, AgentRepositoryDto,
};
use agent_harness::inbound::tool_approvals::{
    self, AnswerToolApprovalRequest, AnswerToolApprovalResponse, ToolApprovalAnswerDto,
    ToolApprovalStatusDto,
};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId, PromptAttachment};
use agent_session::domain::coding_agents::CodingAgent;
use agent_session::domain::model::{ArchiveCause, SandboxSize, SessionBot};
use agent_session::domain::pull_request_links::{
    PullRequestLinkSource, PullRequestLinkedSession, PullRequestSessions, SessionPullRequestLink,
};
use agent_session::domain::updates::{AgentUpdate, AgentUpdateKind, AgentUpdates};
use agent_session::inbound::axum_router::auto_archive::{
    AutoArchiveOverridesBody, AutoArchivePreferencesBody, SessionAutoArchiveResponse,
};
use agent_session::inbound::axum_router::pull_requests::{
    PullRequestSessionsResponse, PullRequestUrl, PullRequestUrls, PullRequestsSessionsResponse,
    SessionPullRequestsResponse,
};
use agent_session::inbound::axum_router::task::{LinkTaskRequest, LinkedTaskResponse};
use agent_session::inbound::axum_router::work_registration::WorkRegistrationResponse;
use agent_session::inbound::axum_router::{
    self, AgentSessionFoldedLogResponse, AgentSessionLogEntryDto, AgentSessionLogResponse,
    AgentSessionPreviewData, AgentSessionPreviewDto, AgentSessionQueueResponse,
    AgentSessionResponse, CodingPreferencesBody, ControlRequest, ControlResponse, ControlStatusDto,
    CreateAgentSessionRequest, CreateAgentSessionResponse, CreateSessionThread,
    EditQueuedActionRequest, LogDirectionDto, LogFrameDto, PreviewAgentSessionsRequest,
    PreviewAgentSessionsResponse, QueuedActionDto, RenameAgentSessionRequest, SandboxSizeBody,
    SessionStatusDto, SetAgentSessionArchivedRequest, WithAgentSessionId,
};
use agent_session::inbound::coding_agents::{self, CodingAgentsResponse};
use utoipa::{
    Modify, OpenApi,
    openapi::security::{Http, HttpAuthScheme, SecurityScheme},
};

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearerAuth",
                SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
            );
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    modifiers(&SecurityAddon),
    info(terms_of_service = "https://macro.com/terms"),
    paths(
        crate::voice_gateway::catalog,
        crate::voice_gateway::sample,
        universal_input::inbound::axum_router::classify,
        universal_input::inbound::axum_router::extract,
        agent_code_mode::inbound::axum_router::get_code_execution,
        agent_session::inbound::axum_router::activity::get_agent_session_activity,
        agent_code_mode::inbound::axum_router::create_review,
        agent_code_mode::inbound::axum_router::present_view,
        agent_code_mode::inbound::axum_router::open_in_app,
        agent_code_mode::inbound::axum_router::get_review,
        agent_code_mode::inbound::axum_router::list_reviews,
        agent_code_mode::inbound::axum_router::decide_review,
        agent_code_mode::inbound::axum_router::list_connected_apps,
        agent_code_mode::inbound::axum_router::list_connected_app_tools,
        agent_code_mode::inbound::axum_router::call_connected_app_tool,
        agent_code_mode::inbound::axum_router::search_connected_app_tools,
        agent_code_mode::inbound::axum_router::discover_connected_apps,
        agent_code_mode::inbound::axum_router::add_connected_mcp_server,
        axum_router::create_agent_session_handler,
        axum_router::warm_agent_session_handler,
        axum_router::get_agent_session_handler,
        axum_router::preview_agent_sessions_handler,
        axum_router::rename_agent_session_handler,
        axum_router::set_agent_session_archived_handler,
        axum_router::sharing::get_agent_session_permissions,
        axum_router::sharing::update_agent_session_permissions,
        axum_router::pull_requests::list_session_pull_requests,
        axum_router::pull_requests::link_session_pull_request,
        axum_router::pull_requests::unlink_session_pull_request,
        axum_router::pull_requests::sessions_for_pull_request,
        axum_router::pull_requests::sessions_for_pull_requests,
        axum_router::task::link_agent_session_task,
        axum_router::updates::list_agent_session_updates,
        axum_router::get_agent_session_log_handler,
        axum_router::get_agent_session_folded_log_handler,
        axum_router::control_agent_session_handler,
        axum_router::get_agent_session_queue_handler,
        axum_router::edit_queued_action_handler,
        axum_router::remove_queued_action_handler,
        axum_router::steer_queued_action_handler,
        axum_router::delete_agent_session_handler,
        axum_router::put_agent_session_sandbox_size_handler,
        axum_router::get_agent_sandbox_size_handler,
        axum_router::put_agent_sandbox_size_handler,
        axum_router::get_agent_coding_preferences_handler,
        axum_router::put_agent_coding_preferences_handler,
        axum_router::auto_archive::get_auto_archive_preferences,
        axum_router::auto_archive::put_auto_archive_preferences,
        axum_router::auto_archive::get_session_auto_archive,
        axum_router::auto_archive::put_session_auto_archive,
        axum_router::work_registration::register_work,
        axum_router::work_registration::unregister_work,
        axum_router::work_registration::list_own_work,
        model_load::load_agent_models_handler,
        capability_discovery::discover_agent_capabilities_handler,
        agent_harness::inbound::conversations::list_agent_conversations,
        agent_harness::inbound::conversations::retry_agent_conversation_turn,
        agent_harness::inbound::conversations::start_fresh_agent_conversation,
        repositories::list_agent_repositories_handler,
        coding_agents::list_coding_agents_handler,
        repositories::list_agent_repository_branches_handler,
        mode_choice::choose_agent_mode_handler,
        changes_router::get_agent_session_changes_handler,
        changes_router::get_agent_session_changes_patch_handler,
        changes_router::refresh_agent_session_changes_handler,
        tool_approvals::answer_tool_approval_handler,
        app_connections::app_connected_handler,
        crate::computers::claude::claude_sign_in_handler,
        crate::computers::claude::claude_sign_in_complete_handler,
        crate::computers::claude::claude_sign_in_cancel_handler,
        crate::computers::claude::claude_sign_out_handler,
        crate::computers::claude::claude_mode_handler,
    ),
    components(schemas(
        team_agents::domain::voice::Voice,
        CodingAgent,
        CodingAgentsResponse,
        CreateAgentSessionRequest,
        CreateAgentSessionResponse,
        CreateSessionThread,
        ControlRequest,
        ControlResponse,
        ControlStatusDto,
        AgentSessionQueueResponse,
        QueuedActionDto,
        EditQueuedActionRequest,
        AgentAction,
        AgentActionId,
        PromptAttachment,
        AgentSessionResponse,
        PreviewAgentSessionsRequest,
        PreviewAgentSessionsResponse,
        AgentSessionPreviewDto,
        AgentSessionPreviewData,
        WithAgentSessionId,
        RenameAgentSessionRequest,
        SetAgentSessionArchivedRequest,
        PullRequestUrl,
        SessionPullRequestsResponse,
        PullRequestSessionsResponse,
        PullRequestUrls,
        PullRequestsSessionsResponse,
        LinkTaskRequest,
        LinkedTaskResponse,
        AgentUpdates,
        AgentUpdate,
        AgentUpdateKind,
        PullRequestSessions,
        PullRequestLinkedSession,
        SessionPullRequestLink,
        PullRequestLinkSource,
        SessionStatusDto,
        AgentSessionLogResponse,
        AgentSessionFoldedLogResponse,
        AgentSessionLogEntryDto,
        SessionBot,
        LogFrameDto,
        LogDirectionDto,
        SandboxSize,
        SandboxSizeBody,
        CodingPreferencesBody,
        AutoArchivePreferencesBody,
        AutoArchiveOverridesBody,
        ArchiveCause,
        SessionAutoArchiveResponse,
        WorkRegistrationResponse,
        LoadAgentModelsRequest,
        LoadAgentModelsResponse,
        AgentModelDto,
        AgentModelsStatusDto,
        ModelHarnessDto,
        AgentRepositoriesResponse,
        AgentModeChoiceRequest,
        AgentModeChoiceResponse,
        AgentMode,
        AgentRepositoryBranchesResponse,
        AgentRepositoryDto,
        AgentSessionChangesResponse,
        AgentSessionChangesPatchResponse,
        ChangesetDto,
        ChangedFileDto,
        GitRefDto,
        CaptureAttemptDto,
        CaptureOutcomeDto,
        ChangesetSourceDto,
        FileChangeKindDto,
        AnswerToolApprovalRequest,
        AppConnectedRequest,
        AnswerToolApprovalResponse,
        ToolApprovalAnswerDto,
        ToolApprovalStatusDto,
        crate::computers::claude::ClaudeSignInStarted,
        crate::computers::claude::ClaudeSignInComplete,
        crate::computers::claude::ClaudeSignedIn,
        crate::computers::claude::ClaudeModeResponse,
        crate::computers::claude::ClaudeAccountStatus,
    )),
    tags(
        (name = "agent-sessions", description = "Agent sessions"),
        (name = "agent-models", description = "Fresh provider model discovery"),
        (name = "agent-repositories", description = "Repositories a coding session can work on"),
        (name = "agent-mode-choice", description = "Whether a composer prompt goes to a chat or a coding agent"),
        (name = "computers", description = "Claude sign-in on Macro computers"),
        (name = "voices", description = "Voices agent teammates speak with on calls")
    )
)]
pub struct ApiDoc;
