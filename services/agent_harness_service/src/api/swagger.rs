//! OpenAPI document for the agent harness service's session routes.

use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::model::SessionBot;
use agent_session::inbound::axum_router::{
    self, AgentSessionLogEntryDto, AgentSessionLogResponse, AgentSessionResponse, ControlRequest,
    LogDirectionDto, LogFrameDto, SessionStatusDto,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(terms_of_service = "https://macro.com/terms"),
    paths(
        axum_router::get_agent_session_handler,
        axum_router::get_agent_session_log_handler,
        axum_router::control_agent_session_handler,
        axum_router::delete_agent_session_handler,
    ),
    components(schemas(
        ControlRequest,
        AgentAction,
        AgentActionId,
        AgentSessionResponse,
        SessionStatusDto,
        AgentSessionLogResponse,
        AgentSessionLogEntryDto,
        SessionBot,
        LogFrameDto,
        LogDirectionDto,
    )),
    tags((name = "agent-sessions", description = "Agent sessions"))
)]
pub struct ApiDoc;
