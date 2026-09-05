use crate::domain::{
    models::{CatalogEntry, PipedreamConnection},
    ports::{ConnectionStore, ConnectorDirectory, PipedreamConnect},
    service::{
        catalog::browse_catalog,
        connect::{PipedreamConnectError, complete_pipedream_connection, disconnect_mcp_server},
    },
};
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};

/// Hook invoked after a connect flow completes and the record is saved.
/// Hosts use this to react to a connection the moment it exists (e.g. start
/// import gather jobs); implementations must be quick or spawn.
pub type PipedreamAuthCompletedHook = Arc<
    dyn Fn(PipedreamConnection) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync,
>;

/// Shared state for the MCP router.
///
/// `pipedream` is the single connect path. When it is `None` (deployment not
/// configured), the connect and catalog endpoints answer 501; there is no
/// fallback flow.
pub struct PipedreamRouterState<S, P, Auth> {
    store: Arc<S>,
    pipedream: Option<Arc<P>>,
    authorization_state: MacroAuthorizationState<Auth>,
    on_auth_completed: Option<PipedreamAuthCompletedHook>,
}

impl<S, P, Auth> Clone for PipedreamRouterState<S, P, Auth> {
    fn clone(&self) -> Self {
        Self {
            store: self.store.clone(),
            pipedream: self.pipedream.clone(),
            authorization_state: self.authorization_state.clone(),
            on_auth_completed: self.on_auth_completed.clone(),
        }
    }
}

impl<S, P, Auth> FromRef<PipedreamRouterState<S, P, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &PipedreamRouterState<S, P, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<S, P, Auth> PipedreamRouterState<S, P, Auth>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory,
    Auth: MacroAuthorizationService,
{
    /// Create a new router state from a server store, the Pipedream client
    /// (None when the deployment has no Pipedream configured), and
    /// authorization state.
    pub fn new(
        store: S,
        pipedream: Option<Arc<P>>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            store: Arc::new(store),
            pipedream,
            authorization_state,
            on_auth_completed: None,
        }
    }

    /// Invoke `hook` whenever a connect flow completes (see
    /// [`PipedreamAuthCompletedHook`]).
    pub fn with_auth_completed_hook(mut self, hook: PipedreamAuthCompletedHook) -> Self {
        self.on_auth_completed = Some(hook);
        self
    }

    /// Access the underlying server store.
    pub fn store(&self) -> Arc<S> {
        self.store.clone()
    }

    fn pipedream(&self) -> Result<&Arc<P>, PipedreamHandlerErr> {
        self.pipedream
            .as_ref()
            .ok_or(PipedreamHandlerErr::PipedreamNotConfigured)
    }
}

/// Authenticated MCP routes: connected-app CRUD, the Pipedream connect flow,
/// and the connector catalog.
pub fn pipedream_mcp_router<S, P, Auth, Global>(
    state: PipedreamRouterState<S, P, Auth>,
) -> Router<Global>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
    Global: Send + Sync,
{
    Router::new()
        .route(
            "/pipedream/mcp/connections",
            get(list_connections::<S, P, Auth>),
        )
        .route(
            "/pipedream/mcp/connections",
            put(update_connection::<S, P, Auth>),
        )
        .route(
            "/pipedream/mcp/connections",
            delete(delete_connection::<S, P, Auth>),
        )
        .route(
            "/pipedream/mcp/token",
            post(create_connect_token::<S, P, Auth>),
        )
        .route(
            "/pipedream/mcp/complete",
            post(complete_connection::<S, P, Auth>),
        )
        .route(
            "/pipedream/mcp/catalog",
            get(browse_catalog_handler::<S, P, Auth>),
        )
        .with_state(state)
}

// -- request / response types ------------------------------------------------

/// Request body for updating a connected app.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PipedreamUpdateRequest {
    /// The app slug to update.
    app_slug: String,
    /// New display name for the connector.
    #[serde(default)]
    server_name: Option<String>,
    /// Enable or disable the connector.
    #[serde(default)]
    enabled: Option<bool>,
}

/// Query parameters for deleting a connected app.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PipedreamDeleteParams {
    /// The app slug to disconnect.
    app_slug: String,
}

/// Response from creating a Pipedream Connect token.
#[derive(Debug, Serialize, ToSchema)]
pub struct PipedreamTokenResponse {
    /// Short-lived token to open the Pipedream Connect UI with.
    token: String,
    /// RFC 3339 expiry of the token.
    expires_at: String,
    /// Shareable link that opens the same connect flow in a browser tab.
    connect_link_url: String,
}

/// Request body for completing a Pipedream connect flow.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PipedreamCompleteRequest {
    /// The connected-account ID reported by the Connect UI on success.
    account_id: String,
    /// Optional display name for the connector. Defaults to the app's name
    /// for new connections; existing connections keep their name.
    #[serde(default)]
    server_name: Option<String>,
}

/// A connected MCP app as returned by the API.
#[derive(Debug, Serialize, ToSchema)]
pub struct PipedreamConnectionResponse {
    /// Pipedream app name slug, e.g. `linear`.
    app_slug: String,
    /// Human-readable display name.
    server_name: String,
    /// Whether the connector is enabled for tool use.
    enabled: bool,
}

impl PipedreamConnectionResponse {
    fn from_record(record: &PipedreamConnection) -> Self {
        Self {
            app_slug: record.app_slug.clone(),
            server_name: record.server_name.clone(),
            enabled: record.enabled,
        }
    }
}

/// Query parameters for browsing the connector catalog.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PipedreamCatalogParams {
    /// Search query to filter apps by name. Omit to browse.
    #[serde(default)]
    search: Option<String>,
    /// Opaque pagination cursor from a previous response.
    #[serde(default)]
    cursor: Option<String>,
    /// Page size (default 20, max 50).
    #[serde(default)]
    limit: Option<u32>,
}

/// One connectable app in the catalog.
#[derive(Debug, Serialize, ToSchema)]
pub struct PipedreamCatalogEntryResponse {
    /// Pipedream app name slug — pass this to the connect flow.
    app_slug: String,
    /// Human-readable name to display.
    display_name: String,
    /// One-line description of the app.
    description: Option<String>,
    /// URL of the app's icon, when available.
    icon_url: Option<String>,
}

impl From<CatalogEntry> for PipedreamCatalogEntryResponse {
    fn from(entry: CatalogEntry) -> Self {
        Self {
            app_slug: entry.app_slug,
            display_name: entry.display_name,
            description: entry.description,
            icon_url: entry.icon_url,
        }
    }
}

/// A page of the connector catalog.
#[derive(Debug, Serialize, ToSchema)]
pub struct PipedreamCatalogResponse {
    /// Catalog entries in display order (most popular first).
    servers: Vec<PipedreamCatalogEntryResponse>,
    /// Cursor for the next page. Absent on the last page.
    next_cursor: Option<String>,
}

// -- error --------------------------------------------------------------------

/// Error type for MCP HTTP handlers.
#[derive(Debug, thiserror::Error)]
pub enum PipedreamHandlerErr {
    /// The requested record was not found.
    #[error("not found")]
    NotFound,
    /// Pipedream is not configured for this deployment.
    #[error("Pipedream is not configured")]
    PipedreamNotConfigured,
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

impl From<PipedreamConnectError> for PipedreamHandlerErr {
    fn from(err: PipedreamConnectError) -> Self {
        match err {
            PipedreamConnectError::NotFound => PipedreamHandlerErr::NotFound,
            PipedreamConnectError::Internal(e) => PipedreamHandlerErr::Internal(e),
        }
    }
}

impl IntoResponse for PipedreamHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            PipedreamHandlerErr::NotFound => StatusCode::NOT_FOUND,
            PipedreamHandlerErr::PipedreamNotConfigured => StatusCode::NOT_IMPLEMENTED,
            PipedreamHandlerErr::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
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
    path = "/pipedream/mcp/connections",
    tag = "pipedream-mcp",
    operation_id = "list_pipedream_mcp_connections",
    responses(
        (status = 200, body = Vec<PipedreamConnectionResponse>),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// List the MCP apps connected by the authenticated user.
#[tracing::instrument(skip_all, err)]
pub async fn list_connections<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<PipedreamConnectionResponse>>, PipedreamHandlerErr>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    let records = state
        .store
        .list(&user.macro_user_id)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(Json(
        records
            .iter()
            .map(PipedreamConnectionResponse::from_record)
            .collect(),
    ))
}

#[utoipa::path(
    put,
    path = "/pipedream/mcp/connections",
    tag = "pipedream-mcp",
    operation_id = "update_pipedream_mcp_connection",
    request_body = PipedreamUpdateRequest,
    responses(
        (status = 200, body = PipedreamConnectionResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Rename or enable/disable a connected app.
#[tracing::instrument(skip_all, err)]
pub async fn update_connection<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<PipedreamUpdateRequest>,
) -> Result<Json<PipedreamConnectionResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    let mut record = state
        .store
        .load(&user.macro_user_id, &body.app_slug)
        .await
        .map_err(anyhow::Error::from)?
        .ok_or(PipedreamHandlerErr::NotFound)?;

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

    Ok(Json(PipedreamConnectionResponse::from_record(&record)))
}

#[utoipa::path(
    delete,
    path = "/pipedream/mcp/connections",
    tag = "pipedream-mcp",
    operation_id = "delete_pipedream_mcp_connection",
    params(PipedreamDeleteParams),
    responses(
        (status = 204),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// Disconnect an app, revoking its Pipedream account.
#[tracing::instrument(skip_all, err)]
pub async fn delete_connection<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(params): Query<PipedreamDeleteParams>,
) -> Result<StatusCode, PipedreamHandlerErr>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    let pipedream = state.pipedream()?;
    disconnect_mcp_server(
        state.store.as_ref(),
        pipedream.as_ref(),
        &user.macro_user_id,
        &params.app_slug,
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/pipedream/mcp/token",
    tag = "pipedream-mcp",
    operation_id = "create_pipedream_mcp_token",
    responses(
        (status = 200, body = PipedreamTokenResponse),
        (status = 401, body = String),
        (status = 501, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Create a short-lived Pipedream Connect token for the authenticated user.
///
/// The frontend opens Pipedream's hosted Connect UI with this token; the
/// user picks (or is deep-linked into) an app and authorizes it there.
#[tracing::instrument(skip_all, err)]
pub async fn create_connect_token<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<PipedreamTokenResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user;
    let token = state
        .pipedream()?
        .create_connect_token(user.macro_user_id.as_ref())
        .await?;

    Ok(Json(PipedreamTokenResponse {
        token: token.token,
        expires_at: token.expires_at,
        connect_link_url: token.connect_link_url,
    }))
}

#[utoipa::path(
    post,
    path = "/pipedream/mcp/complete",
    tag = "pipedream-mcp",
    operation_id = "complete_pipedream_mcp_connection",
    request_body = PipedreamCompleteRequest,
    responses(
        (status = 200, body = PipedreamConnectionResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse),
        (status = 501, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Register a connected account reported by the Pipedream Connect UI.
///
/// Verifies with Pipedream that the account exists and was connected for
/// the authenticated user before persisting anything.
#[tracing::instrument(skip_all, err)]
pub async fn complete_connection<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<PipedreamCompleteRequest>,
) -> Result<Json<PipedreamConnectionResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    let record = complete_pipedream_connection(
        state.store.as_ref(),
        state.pipedream()?.as_ref(),
        &user.macro_user_id,
        &body.account_id,
        body.server_name.as_deref(),
    )
    .await?;

    if let Some(hook) = &state.on_auth_completed {
        hook(record.clone()).await;
    }

    Ok(Json(PipedreamConnectionResponse::from_record(&record)))
}

#[utoipa::path(
    get,
    path = "/pipedream/mcp/catalog",
    tag = "pipedream-mcp",
    operation_id = "browse_pipedream_mcp_catalog",
    params(PipedreamCatalogParams),
    responses(
        (status = 200, body = PipedreamCatalogResponse),
        (status = 401, body = String),
        (status = 501, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Browse or search the catalog of connectable apps.
///
/// Results come from Pipedream's app directory, most popular first.
#[tracing::instrument(skip_all, err)]
pub async fn browse_catalog_handler<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    _authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(params): Query<PipedreamCatalogParams>,
) -> Result<Json<PipedreamCatalogResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory,
    Auth: MacroAuthorizationService,
{
    let page = browse_catalog(
        state.pipedream()?.as_ref(),
        params.search.as_deref(),
        params.cursor.as_deref(),
        params.limit,
    )
    .await?;

    Ok(Json(PipedreamCatalogResponse {
        servers: page.entries.into_iter().map(Into::into).collect(),
        next_cursor: page.next_cursor,
    }))
}
