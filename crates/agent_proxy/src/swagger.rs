//! OpenAPI documentation for the agent proxy HTTP API.

use utoipa::OpenApi;

/// The OpenAPI document for the agent proxy service.
#[derive(OpenApi)]
#[openapi(
    paths(
        crate::inbound::http::health,
        crate::inbound::http::create_agent,
        crate::inbound::http::get_agent,
        crate::inbound::http::patch_agent,
        crate::inbound::http::delete_agent,
        crate::inbound::http::permanently_delete_agent,
        crate::inbound::http::provision_runtime_connection,
        crate::inbound::http::post_acp,
    ),
    components(schemas(
        crate::inbound::http::CreateAgentRequest,
        crate::inbound::http::PatchAgentRequest,
        crate::inbound::http::ProvisionRuntimeConnectionResponse,
        crate::domain::models::GetAgentResponse,
        chat::domain::models::ChatAgentKind,
        model::response::StringIDResponse,
        model::response::EmptyResponse,
    ))
)]
pub struct ApiDoc;
