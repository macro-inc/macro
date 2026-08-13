//! OpenAPI document for the agent harness service's control routes.

use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::inbound::axum_router::{self, ControlRequest};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(terms_of_service = "https://macro.com/terms"),
    paths(
        axum_router::control_agent_session_handler,
        axum_router::delete_agent_session_handler,
    ),
    components(schemas(ControlRequest, AgentAction)),
    tags((name = "agent-sessions", description = "Live agent session control"))
)]
pub struct ApiDoc;
