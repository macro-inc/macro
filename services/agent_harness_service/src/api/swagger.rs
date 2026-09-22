//! OpenAPI document for the agent harness service's session routes.

use agent_changes::inbound::axum_router::{
    self as changes_router, AgentSessionChangesPatchResponse, AgentSessionChangesResponse,
    CaptureAttemptDto, CaptureOutcomeDto, ChangedFileDto, ChangesetDto, ChangesetSourceDto,
    FileChangeKindDto, GitRefDto,
};
use agent_harness::inbound::model_load::{
    self, AgentModelDto, AgentModelsStatusDto, LoadAgentModelsRequest, LoadAgentModelsResponse,
    ModelHarnessDto,
};
use agent_harness::inbound::repositories::{
    self, AgentRepositoriesResponse, AgentRepositoryBranchesResponse, AgentRepositoryDto,
};
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId, PromptAttachment};
use agent_session::domain::model::{SandboxSize, SessionBot};
use agent_session::inbound::axum_router::{
    self, AgentSessionLogEntryDto, AgentSessionLogResponse, AgentSessionPreviewData,
    AgentSessionPreviewDto, AgentSessionQueueResponse, AgentSessionResponse, ControlRequest,
    ControlResponse, ControlStatusDto, CreateAgentSessionRequest, CreateAgentSessionResponse,
    CreateSessionThread, EditQueuedActionRequest, LogDirectionDto, LogFrameDto,
    PreviewAgentSessionsRequest, PreviewAgentSessionsResponse, QueuedActionDto,
    RenameAgentSessionRequest, SandboxSizeBody, SessionStatusDto, WithAgentSessionId,
};
use claude_cloud_agents::inbound::auth as claude_auth;
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
        claude_auth::status,
        claude_auth::start,
        claude_auth::complete,
        claude_auth::disconnect,
        axum_router::create_agent_session_handler,
        axum_router::get_agent_session_handler,
        axum_router::preview_agent_sessions_handler,
        axum_router::rename_agent_session_handler,
        axum_router::sharing::get_agent_session_permissions,
        axum_router::sharing::update_agent_session_permissions,
        axum_router::get_agent_session_log_handler,
        axum_router::control_agent_session_handler,
        axum_router::get_agent_session_queue_handler,
        axum_router::edit_queued_action_handler,
        axum_router::remove_queued_action_handler,
        axum_router::delete_agent_session_handler,
        axum_router::put_agent_session_sandbox_size_handler,
        axum_router::get_agent_sandbox_size_handler,
        axum_router::put_agent_sandbox_size_handler,
        model_load::load_agent_models_handler,
        repositories::list_agent_repositories_handler,
        repositories::list_agent_repository_branches_handler,
        changes_router::get_agent_session_changes_handler,
        changes_router::get_agent_session_changes_patch_handler,
        changes_router::refresh_agent_session_changes_handler,
    ),
    components(schemas(
        claude_auth::StatusResponse,
        claude_auth::StartResponse,
        claude_auth::CompleteRequest,
        claude_auth::EmptyRequest,
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
        SessionStatusDto,
        AgentSessionLogResponse,
        AgentSessionLogEntryDto,
        SessionBot,
        LogFrameDto,
        LogDirectionDto,
        SandboxSize,
        SandboxSizeBody,
        LoadAgentModelsRequest,
        LoadAgentModelsResponse,
        AgentModelDto,
        AgentModelsStatusDto,
        ModelHarnessDto,
        AgentRepositoriesResponse,
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
    )),
    tags(
        (name = "agent-sessions", description = "Agent sessions"),
        (name = "agent-models", description = "Fresh provider model discovery"),
        (name = "agent-repositories", description = "Repositories a coding session can work on")
    )
)]
pub struct ApiDoc;
