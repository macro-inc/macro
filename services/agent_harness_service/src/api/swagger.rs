//! OpenAPI document for the agent harness service's session routes.

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::model::{SandboxSize, SessionBot};
use agent_session::inbound::axum_router::{
    self, AgentSessionLogEntryDto, AgentSessionLogResponse, AgentSessionQueueResponse,
    AgentSessionResponse, ControlRequest, ControlResponse, ControlStatusDto,
    CreateAgentSessionRequest, CreateAgentSessionResponse, CreateSessionThread,
    EditQueuedActionRequest, LogDirectionDto, LogFrameDto, QueuedActionDto,
    RenameAgentSessionRequest, SandboxSizeBody, SessionStatusDto,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(terms_of_service = "https://macro.com/terms"),
    paths(
        axum_router::create_agent_session_handler,
        axum_router::get_agent_session_handler,
        axum_router::rename_agent_session_handler,
        axum_router::get_agent_session_log_handler,
        axum_router::control_agent_session_handler,
        axum_router::get_agent_session_queue_handler,
        axum_router::edit_queued_action_handler,
        axum_router::remove_queued_action_handler,
        axum_router::delete_agent_session_handler,
        axum_router::put_agent_session_sandbox_size_handler,
        axum_router::get_agent_sandbox_size_handler,
        axum_router::put_agent_sandbox_size_handler,
    ),
    components(schemas(
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
        AgentSessionResponse,
        RenameAgentSessionRequest,
        SessionStatusDto,
        AgentSessionLogResponse,
        AgentSessionLogEntryDto,
        SessionBot,
        LogFrameDto,
        LogDirectionDto,
        SandboxSize,
        SandboxSizeBody,
    )),
    tags((name = "agent-sessions", description = "Agent sessions"))
)]
pub struct ApiDoc;
