//! OpenAPI document for the agent harness service: sessions, agents,
//! harnesses, and Cursor connections.

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

use super::cursor_api_key::{
    self, CursorApiKeyStatus,
    list_cursor_models::{CursorModelOption, CursorModelsResponse},
    put_cursor_api_key::PutCursorApiKeyRequest,
    put_cursor_default_model::PutCursorDefaultModelRequest,
};

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
        // agents
        bots::inbound::agents_router::create_agent_handler,
        bots::inbound::agents_router::list_agents_handler,
        bots::inbound::agents_router::update_agent_handler,
        // harnesses
        harnesses::inbound::axum_router::create_pairing_handler,
        harnesses::inbound::axum_router::get_pairing_handler,
        harnesses::inbound::axum_router::approve_pairing_handler,
        harnesses::inbound::axum_router::claim_pairing_handler,
        harnesses::inbound::axum_router::list_harnesses_handler,
        harnesses::inbound::axum_router::delete_harness_handler,
        harnesses::inbound::axum_router::list_bound_agents_handler,
        harnesses::inbound::axum_router::get_self_harness_handler,
        harnesses::inbound::axum_router::delete_self_harness_handler,
        harnesses::inbound::axum_router::list_harness_sessions_handler,
        // cursor connection
        cursor_api_key::get_cursor_api_key::handler,
        cursor_api_key::put_cursor_api_key::handler,
        cursor_api_key::delete_cursor_api_key::handler,
        cursor_api_key::list_cursor_models::handler,
        cursor_api_key::put_cursor_default_model::handler,
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
        // agents
        bots::domain::models::Agent,
        bots::domain::models::AgentChannelScope,
        bots::domain::models::AgentMcpServers,
        bots::domain::models::AgentMcpServer,
        bots::domain::models::CreateAgentRequest,
        bots::domain::models::UpdateAgentRequest,
        bots::domain::models::Bot,
        bots::domain::models::BotKind,
        bots::domain::models::BotOwner,
        // harnesses
        harnesses::domain::models::Harness,
        harnesses::domain::models::HarnessOwner,
        harnesses::domain::models::HarnessAgent,
        harnesses::domain::models::HarnessSession,
        harnesses::domain::models::RequestedHarnessScope,
        harnesses::domain::models::CreatePairingRequest,
        harnesses::domain::models::CreatedPairing,
        harnesses::domain::models::PairingDetails,
        harnesses::domain::models::ApprovePairingRequest,
        harnesses::domain::models::ClaimPairingRequest,
        harnesses::domain::models::ClaimedPairing,
        harnesses::inbound::axum_router::PendingClaimResponse,
        // cursor connection
        CursorApiKeyStatus,
        PutCursorApiKeyRequest,
        PutCursorDefaultModelRequest,
        CursorModelOption,
        CursorModelsResponse,
    )),
    tags(
        (name = "agent-sessions", description = "Agent sessions"),
        (name = "agents", description = "Agents (personas) sessions run as"),
        (name = "harnesses", description = "Registered harnesses and pairing"),
        (name = "cursor", description = "Cursor connection"),
    )
)]
pub struct ApiDoc;
