use crate::domain::{
    models::McpServerRecord,
    ports::{McpServerStore, OAuthClient},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};

/// Shared state for the MCP router.
pub struct McpRouterState<S, O> {
    store: Arc<S>,
    oauth: Arc<O>,
}

impl<S, O> Clone for McpRouterState<S, O> {
    fn clone(&self) -> Self {
        Self {
            store: self.store.clone(),
            oauth: self.oauth.clone(),
        }
    }
}

impl<S, O> McpRouterState<S, O>
where
    S: McpServerStore,
    O: OAuthClient,
{
    /// Create a new router state from a server store and OAuth client.
    pub fn new(store: S, oauth: O) -> Self {
        Self {
            store: Arc::new(store),
            oauth: Arc::new(oauth),
        }
    }

    /// Access the underlying server store.
    pub fn store(&self) -> Arc<S> {
        self.store.clone()
    }
}

/// Authenticated MCP routes (CRUD + start auth).
pub fn mcp_router<S, O, Global>(state: McpRouterState<S, O>) -> Router<Global>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
    Global: Send + Sync,
{
    Router::new()
        .route("/mcp/servers", get(list_servers::<S, O>))
        .route("/mcp/servers", post(add_server::<S, O>))
        .route("/mcp/servers", put(update_server::<S, O>))
        .route("/mcp/servers", delete(delete_server::<S, O>))
        .route("/mcp/servers/auth/start", post(start_auth::<S, O>))
        .with_state(state)
}

/// Unauthenticated OAuth callback route.
pub fn mcp_oauth_callback_router<S, O, Global>(state: McpRouterState<S, O>) -> Router<Global>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
    Global: Send + Sync,
{
    Router::new()
        .route("/mcp/servers/auth/callback", get(auth_callback::<S, O>))
        .with_state(state)
}

// -- request / response types ------------------------------------------------

/// Request body for adding a new MCP server.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AddServerRequest {
    /// The MCP server's streamable HTTP URL.
    url: String,
    /// Human-readable name for the server.
    server_name: String,
}

/// Request body for updating an MCP server.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateServerRequest {
    /// The server URL to update.
    url: String,
    /// New name for the server.
    #[serde(default)]
    server_name: Option<String>,
    /// Enable or disable the server.
    #[serde(default)]
    enabled: Option<bool>,
}

/// Query parameters for deleting an MCP server.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DeleteServerParams {
    /// The server URL to delete.
    url: String,
}

/// Request body for starting an OAuth authorization flow.
#[derive(Debug, Deserialize, ToSchema)]
pub struct StartAuthRequest {
    /// The MCP server URL to authorize against.
    server_url: String,
    /// Human-readable name for the server.
    server_name: String,
}

/// Response from starting an OAuth authorization flow.
#[derive(Debug, Serialize, ToSchema)]
pub struct StartAuthResponse {
    /// The OAuth authorization URL to redirect the user to.
    authorization_url: String,
}

/// Query parameters received on the OAuth callback redirect.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AuthCallbackParams {
    /// Authorization code from the OAuth provider.
    code: String,
    /// CSRF state parameter.
    state: String,
}

/// An MCP server record as returned by the API.
#[derive(Debug, Serialize, ToSchema)]
pub struct ServerResponse {
    /// The MCP server URL.
    url: String,
    /// Human-readable server name.
    server_name: String,
    /// Whether the server is enabled for tool use.
    enabled: bool,
    /// Whether the server has valid stored credentials.
    authenticated: bool,
}

impl ServerResponse {
    fn from_record(record: &McpServerRecord) -> Self {
        Self {
            url: record.url.clone(),
            server_name: record.server_name.clone(),
            enabled: record.enabled,
            authenticated: record.credentials.is_some(),
        }
    }
}

// -- error --------------------------------------------------------------------

/// Error type for MCP HTTP handlers.
#[derive(Debug, thiserror::Error)]
pub enum McpHandlerErr {
    /// The requested server was not found.
    #[error("server not found")]
    NotFound,
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for McpHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            McpHandlerErr::NotFound => StatusCode::NOT_FOUND,
            McpHandlerErr::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

// -- handlers -----------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/mcp/servers",
    tag = "mcp",
    operation_id = "list_mcp_servers",
    responses(
        (status = 200, body = Vec<ServerResponse>),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// List all MCP servers configured for the authenticated user.
pub async fn list_servers<S, O>(
    State(state): State<McpRouterState<S, O>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
) -> Result<Json<Vec<ServerResponse>>, McpHandlerErr>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
{
    let records = state
        .store
        .list(&macro_user_id)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(Json(
        records.iter().map(ServerResponse::from_record).collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/mcp/servers",
    tag = "mcp",
    operation_id = "add_mcp_server",
    request_body = AddServerRequest,
    responses(
        (status = 201, body = ServerResponse),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// Add a new MCP server for the authenticated user.
pub async fn add_server<S, O>(
    State(state): State<McpRouterState<S, O>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
    Json(body): Json<AddServerRequest>,
) -> Result<(StatusCode, Json<ServerResponse>), McpHandlerErr>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
{
    let record = McpServerRecord {
        user_id: macro_user_id,
        url: body.url,
        server_name: body.server_name,
        credentials: None,
        enabled: true,
    };

    state
        .store
        .save(&record)
        .await
        .map_err(anyhow::Error::from)?;

    Ok((
        StatusCode::CREATED,
        Json(ServerResponse::from_record(&record)),
    ))
}

#[utoipa::path(
    put,
    path = "/mcp/servers",
    tag = "mcp",
    operation_id = "update_mcp_server",
    request_body = UpdateServerRequest,
    responses(
        (status = 200, body = ServerResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Update an existing MCP server's name or enabled status.
pub async fn update_server<S, O>(
    State(state): State<McpRouterState<S, O>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
    Json(body): Json<UpdateServerRequest>,
) -> Result<Json<ServerResponse>, McpHandlerErr>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
{
    let mut record = state
        .store
        .load(&macro_user_id, &body.url)
        .await
        .map_err(anyhow::Error::from)?
        .ok_or(McpHandlerErr::NotFound)?;

    if let Some(name) = body.server_name {
        record.server_name = name;
    }
    if let Some(enabled) = body.enabled {
        record.enabled = enabled;
    }

    state
        .store
        .save(&record)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(Json(ServerResponse::from_record(&record)))
}

#[utoipa::path(
    delete,
    path = "/mcp/servers",
    tag = "mcp",
    operation_id = "delete_mcp_server",
    params(DeleteServerParams),
    responses(
        (status = 204),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// Delete an MCP server by URL.
pub async fn delete_server<S, O>(
    State(state): State<McpRouterState<S, O>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
    Query(params): Query<DeleteServerParams>,
) -> Result<StatusCode, McpHandlerErr>
where
    S: McpServerStore,
    O: OAuthClient,
    anyhow::Error: From<S::Err>,
{
    state
        .store
        .delete(&macro_user_id, &params.url)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/mcp/servers/auth/start",
    tag = "mcp",
    operation_id = "start_mcp_auth",
    request_body = StartAuthRequest,
    responses(
        (status = 200, body = StartAuthResponse),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// Start the OAuth authorization flow for an MCP server.
pub async fn start_auth<S, O>(
    State(state): State<McpRouterState<S, O>>,
    MacroUserExtractor { macro_user_id, .. }: MacroUserExtractor,
    Json(body): Json<StartAuthRequest>,
) -> Result<Json<StartAuthResponse>, McpHandlerErr>
where
    S: McpServerStore,
    O: OAuthClient,
{
    let authorization_url = state
        .oauth
        .start_authorization(&macro_user_id, &body.server_url, &body.server_name)
        .await?;

    Ok(Json(StartAuthResponse { authorization_url }))
}

#[utoipa::path(
    get,
    path = "/mcp/servers/auth/callback",
    tag = "mcp",
    operation_id = "mcp_auth_callback",
    params(AuthCallbackParams),
    responses(
        (status = 200, description = "OAuth flow completed successfully"),
        (status = 500, body = ErrorResponse),
    )
)]
/// OAuth callback endpoint — receives code and state from the authorization server.
pub async fn auth_callback<S, O>(
    State(state): State<McpRouterState<S, O>>,
    Query(params): Query<AuthCallbackParams>,
) -> Result<StatusCode, McpHandlerErr>
where
    S: McpServerStore,
    O: OAuthClient,
{
    state
        .oauth
        .exchange_authorization_code(&params.code, &params.state)
        .await?;

    Ok(StatusCode::OK)
}
