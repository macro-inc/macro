use crate::domain::{
    models::{CatalogEntry, ConnectionProvider, ConnectorOverlay, PipedreamConnection},
    ports::{
        ConnectionStore, ConnectorDirectory, ConnectorOverlays, MacroConnect, PipedreamConnect,
    },
    service::{
        catalog::browse_catalog,
        connect::{
            PipedreamConnectError, complete_connect_connection, complete_pipedream_connection,
            connections_to_reconnect, disconnect_mcp_server, recover_pipedream_connection,
            start_connect_session,
        },
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

#[cfg(test)]
mod test;

/// Hook invoked after a connect flow completes and the record is saved.
/// Hosts use this to react to a connection the moment it exists (e.g. record
/// analytics); implementations must be quick or spawn.
pub type PipedreamAuthCompletedHook = Arc<
    dyn Fn(PipedreamConnection) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync,
>;

/// Hook invoked after a user disconnects an app, with the connection as it
/// was before removal. Implementations must be quick or spawn.
pub type PipedreamDisconnectedHook = PipedreamAuthCompletedHook;

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
    on_disconnected: Option<PipedreamDisconnectedHook>,
}

impl<S, P, Auth> Clone for PipedreamRouterState<S, P, Auth> {
    fn clone(&self) -> Self {
        Self {
            store: self.store.clone(),
            pipedream: self.pipedream.clone(),
            authorization_state: self.authorization_state.clone(),
            on_auth_completed: self.on_auth_completed.clone(),
            on_disconnected: self.on_disconnected.clone(),
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
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
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
            on_disconnected: None,
        }
    }

    /// Invoke `hook` whenever a connect flow completes (see
    /// [`PipedreamAuthCompletedHook`]).
    pub fn with_auth_completed_hook(mut self, hook: PipedreamAuthCompletedHook) -> Self {
        self.on_auth_completed = Some(hook);
        self
    }

    /// Invoke `hook` whenever a user disconnects an app (see
    /// [`PipedreamDisconnectedHook`]).
    pub fn with_disconnected_hook(mut self, hook: PipedreamDisconnectedHook) -> Self {
        self.on_disconnected = Some(hook);
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

    /// Whether `user_id` is on Macro Connect alone (see
    /// [`MacroConnect::connect_only`]).
    async fn connect_only(
        &self,
        user_id: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> bool {
        match &self.pipedream {
            Some(backends) => backends.connect_only(user_id).await,
            None => false,
        }
    }
}

/// Authenticated MCP routes: connected-app CRUD, the Pipedream connect flow,
/// and the connector catalog.
pub fn pipedream_mcp_router<S, P, Auth, Global>(
    state: PipedreamRouterState<S, P, Auth>,
) -> Router<Global>
where
    S: ConnectionStore + ConnectorOverlays,
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
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
            "/pipedream/mcp/reconnects",
            get(list_reconnects::<S, P, Auth>),
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
            "/pipedream/mcp/recover",
            post(recover_connection::<S, P, Auth>),
        )
        .route(
            "/pipedream/mcp/connect/complete",
            post(complete_connect::<S, P, Auth>),
        )
        .route(
            "/pipedream/mcp/catalog",
            get(browse_catalog_handler::<S, P, Auth>),
        )
        .route("/pipedream/mcp/overlays", get(list_overlays::<S, P, Auth>))
        .with_state(state)
}

/// The public Pipedream webhook route.
///
/// Pipedream posts connect-flow outcomes here, including the failures that
/// happen inside its hosted Connect UI — those never reach an authenticated
/// endpoint of ours, so without this the only evidence a flow died is a
/// minted token with no matching completion. Unauthenticated by necessity
/// (Pipedream is the caller), so the configured `webhook_uri` carries a
/// shared secret that every request is checked against.
///
/// Mounted outside the authenticated router, alongside the MCP OAuth
/// callback.
pub fn pipedream_webhook_router<Global>(secret: String) -> Router<Global>
where
    Global: Send + Sync,
{
    Router::new()
        .route("/pipedream/mcp/webhook", post(pipedream_webhook))
        .with_state(PipedreamWebhookState {
            secret: Arc::from(secret),
        })
}

/// The public page Macro Connect sends the browser to after consent.
///
/// It records nothing: the page only tells the user to return to Macro and
/// closes itself. The app, polling the authenticated
/// `/pipedream/mcp/connect/complete`, records the connection once Connect
/// confirms it, so nothing in this unauthenticated request is trusted.
pub fn pipedream_connect_callback_router<Global>() -> Router<Global>
where
    Global: Send + Sync + Clone + 'static,
{
    Router::new().route("/pipedream/mcp/connect/callback", get(connect_callback))
}

/// Query Connect appends to the callback URL.
#[derive(Debug, Deserialize)]
pub struct ConnectCallbackQuery {
    /// `connected` or `error`.
    status: Option<String>,
}

#[tracing::instrument(skip_all, fields(status = query.status.as_deref()))]
async fn connect_callback(
    Query(query): Query<ConnectCallbackQuery>,
) -> axum::response::Html<&'static str> {
    axum::response::Html(match query.status.as_deref() {
        Some("connected") => CONNECT_CALLBACK_CONNECTED,
        _ => CONNECT_CALLBACK_FAILED,
    })
}

const CONNECT_CALLBACK_CONNECTED: &str = "<!doctype html><meta charset=utf-8><title>Connected</title><p>Connected. You can close this window and return to Macro.</p><script>window.close()</script>";
const CONNECT_CALLBACK_FAILED: &str = "<!doctype html><meta charset=utf-8><title>Not connected</title><p>The connection did not finish. Close this window and try again in Macro.</p>";

/// State for the public webhook route: the shared secret, nothing else.
#[derive(Clone)]
pub struct PipedreamWebhookState {
    secret: Arc<str>,
}

/// Query parameters carried by the configured `webhook_uri`.
#[derive(Debug, Deserialize)]
pub struct PipedreamWebhookQuery {
    /// Shared secret, compared against the configured one.
    secret: Option<String>,
}

/// Record a connect-flow outcome reported by Pipedream.
///
/// The body is taken as raw JSON on purpose. The payload shape is
/// Pipedream's to change, and an endpoint whose whole job is telling us why
/// connections fail must not start dropping events with a 422 the day they
/// add a field. Only opaque ids, the app, and Pipedream's error text are
/// logged: the payload also carries the Connect token and the account's
/// name and external id, which are personal data.
#[tracing::instrument(skip_all)]
async fn pipedream_webhook(
    State(state): State<PipedreamWebhookState>,
    Query(query): Query<PipedreamWebhookQuery>,
    Json(payload): Json<serde_json::Value>,
) -> StatusCode {
    if query.secret.as_deref() != Some(state.secret.as_ref()) {
        // Anyone can reach this route, so the payload stays out of the log.
        tracing::warn!("rejected Pipedream webhook with a bad or missing secret");
        return StatusCode::UNAUTHORIZED;
    }

    let str_at = |pointer: &str| payload.pointer(pointer).and_then(serde_json::Value::as_str);
    let event = str_at("/event");
    let error = str_at("/error");
    let account_id = str_at("/account/id");
    let app_slug = str_at("/account/app/name_slug");
    let connect_session_id = payload.get("connect_session_id").map(ToString::to_string);
    let failed = error.is_some() || event.is_some_and(|e| e.to_ascii_uppercase().contains("ERROR"));

    if failed {
        tracing::warn!(
            event,
            error,
            account_id,
            connector.app_slug = app_slug,
            connect_session_id,
            "Pipedream connect flow failed"
        );
    } else {
        tracing::info!(
            event,
            account_id,
            connector.app_slug = app_slug,
            connect_session_id,
            "Pipedream connect flow event"
        );
    }

    StatusCode::NO_CONTENT
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

/// Request body for starting a connect flow.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct PipedreamTokenRequest {
    /// The app to connect, by Pipedream slug. With it, an app Macro Connect
    /// serves can answer with a Connect URL instead of a Pipedream token.
    #[serde(default)]
    app_slug: Option<String>,
}

/// Which backend a connection or connect flow uses.
#[derive(Clone, Copy, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PipedreamProviderResponse {
    /// Pipedream Connect.
    Pipedream,
    /// Macro Connect.
    Connect,
}

impl From<ConnectionProvider> for PipedreamProviderResponse {
    fn from(provider: ConnectionProvider) -> Self {
        match provider {
            ConnectionProvider::Pipedream => Self::Pipedream,
            ConnectionProvider::Connect => Self::Connect,
        }
    }
}

/// Response from starting a connect flow: a Pipedream Connect token, or for
/// `provider = connect` a Macro Connect URL.
#[derive(Debug, Serialize, ToSchema)]
pub struct PipedreamTokenResponse {
    /// The backend this flow connects through.
    provider: PipedreamProviderResponse,
    /// Short-lived token to open the Pipedream Connect UI with. Pipedream only.
    token: Option<String>,
    /// RFC 3339 expiry of the token. Pipedream only.
    expires_at: Option<String>,
    /// Shareable link that opens the same connect flow in a browser tab.
    /// Pipedream only.
    connect_link_url: Option<String>,
    /// URL to open in a popup or browser tab for Macro Connect's consent
    /// flow; once it finishes, call `/pipedream/mcp/connect/complete`.
    /// Connect only.
    connect_url: Option<String>,
}

/// Request body for recording a finished Macro Connect flow.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PipedreamConnectCompleteRequest {
    /// The app that was connected, by Pipedream slug.
    app_slug: String,
    /// Optional display name for the connector, as for completion.
    #[serde(default)]
    server_name: Option<String>,
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

/// Request body for recovering a connect flow whose result the Connect UI
/// never reported.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PipedreamRecoverRequest {
    /// The Pipedream app the flow was connecting, by name slug.
    app_slug: String,
    /// Optional display name for the connector, as for completion.
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
    /// The backend holding the grant.
    provider: PipedreamProviderResponse,
}

impl PipedreamConnectionResponse {
    fn from_record(record: &PipedreamConnection) -> Self {
        Self {
            app_slug: record.app_slug.clone(),
            server_name: record.server_name.clone(),
            enabled: record.enabled,
            provider: record.provider.into(),
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
    /// Categories assigned by Pipedream.
    #[serde(default)]
    categories: Vec<String>,
}

impl From<CatalogEntry> for PipedreamCatalogEntryResponse {
    fn from(entry: CatalogEntry) -> Self {
        Self {
            app_slug: entry.app_slug,
            display_name: entry.display_name,
            description: entry.description,
            icon_url: entry.icon_url,
            categories: entry.categories,
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

/// A catalog app that connects through its own MCP server instead of
/// Pipedream.
#[derive(Debug, Serialize, ToSchema)]
pub struct PipedreamOverlayResponse {
    /// Pipedream app name slug, as it appears in the catalog.
    app_slug: String,
    /// The MCP server to authorize with the native MCP OAuth flow.
    server_url: String,
}

impl From<ConnectorOverlay> for PipedreamOverlayResponse {
    fn from(overlay: ConnectorOverlay) -> Self {
        Self {
            app_slug: overlay.app_slug,
            server_url: overlay.server_url,
        }
    }
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
    /// The app connects through its own MCP server, never Pipedream.
    #[error("{0}")]
    Overlaid(String),
    /// The user is on Macro Connect alone, which this request would bypass.
    #[error("{0}")]
    ConnectOnly(&'static str),
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

impl From<PipedreamConnectError> for PipedreamHandlerErr {
    fn from(err: PipedreamConnectError) -> Self {
        match err {
            PipedreamConnectError::NotFound => PipedreamHandlerErr::NotFound,
            err @ PipedreamConnectError::Overlaid { .. } => {
                PipedreamHandlerErr::Overlaid(err.to_string())
            }
            PipedreamConnectError::Internal(e) => PipedreamHandlerErr::Internal(e),
        }
    }
}

impl IntoResponse for PipedreamHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            PipedreamHandlerErr::NotFound => StatusCode::NOT_FOUND,
            PipedreamHandlerErr::PipedreamNotConfigured => StatusCode::NOT_IMPLEMENTED,
            PipedreamHandlerErr::Overlaid(_) => StatusCode::CONFLICT,
            PipedreamHandlerErr::ConnectOnly(_) => StatusCode::CONFLICT,
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
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    let records = state
        .store
        .list(&user.macro_user_id)
        .await
        .map_err(anyhow::Error::from)?;
    // Pipedream connections are unusable to a user on Connect alone; the
    // app shows as not connected until they reconnect it through Connect.
    let connect_only = state.connect_only(&user.macro_user_id).await;

    Ok(Json(
        records
            .iter()
            .filter(|record| !connect_only || record.provider == ConnectionProvider::Connect)
            .map(PipedreamConnectionResponse::from_record)
            .collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/pipedream/mcp/reconnects",
    tag = "pipedream-mcp",
    operation_id = "list_pipedream_mcp_reconnects",
    responses(
        (status = 200, body = Vec<PipedreamConnectionResponse>),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// List the Pipedream connections the authenticated user must reconnect
/// through Macro Connect. Empty for a user who isn't on Connect.
#[tracing::instrument(skip_all, err)]
pub async fn list_reconnects<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<PipedreamConnectionResponse>>, PipedreamHandlerErr>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    if !state.connect_only(&user.macro_user_id).await {
        return Ok(Json(Vec::new()));
    }
    let records = connections_to_reconnect(
        state.store.as_ref(),
        state.pipedream()?.as_ref(),
        &user.macro_user_id,
    )
    .await?;

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
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
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
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    let pipedream = state.pipedream()?;
    let removed = disconnect_mcp_server(
        state.store.as_ref(),
        pipedream.as_ref(),
        &user.macro_user_id,
        &params.app_slug,
    )
    .await?;

    if let (Some(connection), Some(hook)) = (removed, &state.on_disconnected) {
        hook(connection).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/pipedream/mcp/token",
    tag = "pipedream-mcp",
    operation_id = "create_pipedream_mcp_token",
    request_body(content = Option<PipedreamTokenRequest>),
    responses(
        (status = 200, body = PipedreamTokenResponse),
        (status = 401, body = String),
        (status = 501, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Start a connect flow for the authenticated user.
///
/// By default, a short-lived Pipedream Connect token: the frontend opens
/// Pipedream's hosted Connect UI with it, and the user picks (or is
/// deep-linked into) an app and authorizes it there. When the body names an
/// app Macro Connect serves and the `macro-connect` rollout is on for the
/// user, a Connect URL instead.
#[tracing::instrument(skip_all, err)]
pub async fn create_connect_token<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    body: Option<Json<PipedreamTokenRequest>>,
) -> Result<Json<PipedreamTokenResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore + ConnectorOverlays,
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user;
    let pipedream = state.pipedream()?;
    let app_slug = body.and_then(|Json(body)| body.app_slug);
    // A user on Connect alone gets a Connect URL or a 404, never a
    // Pipedream token.
    if state.connect_only(&user.macro_user_id).await {
        let app_slug = app_slug.ok_or(PipedreamHandlerErr::ConnectOnly(
            "name the app to connect through Macro Connect",
        ))?;
        let connect_url = start_connect_session(pipedream.as_ref(), &user.macro_user_id, &app_slug)
            .await?
            .ok_or(PipedreamHandlerErr::NotFound)?;
        return Ok(Json(PipedreamTokenResponse {
            provider: PipedreamProviderResponse::Connect,
            token: None,
            expires_at: None,
            connect_link_url: None,
            connect_url: Some(connect_url),
        }));
    }

    let token = pipedream
        .create_connect_token(user.macro_user_id.as_ref())
        .await?;

    Ok(Json(PipedreamTokenResponse {
        provider: PipedreamProviderResponse::Pipedream,
        token: Some(token.token),
        expires_at: Some(token.expires_at),
        connect_link_url: Some(token.connect_link_url),
        connect_url: None,
    }))
}

#[utoipa::path(
    post,
    path = "/pipedream/mcp/connect/complete",
    tag = "pipedream-mcp",
    operation_id = "complete_pipedream_mcp_connect",
    request_body = PipedreamConnectCompleteRequest,
    responses(
        (status = 200, body = PipedreamConnectionResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse),
        (status = 501, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Record an app the user connected through Macro Connect.
///
/// Answers 404 until Connect lists an active connection for this user and
/// app, so the frontend can poll it while the consent window is open.
#[tracing::instrument(skip_all, err, fields(connector.app_slug = %body.app_slug))]
pub async fn complete_connect<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<PipedreamConnectCompleteRequest>,
) -> Result<Json<PipedreamConnectionResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore + ConnectorOverlays,
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    if !state.connect_only(&user.macro_user_id).await {
        return Err(PipedreamHandlerErr::NotFound);
    }
    let record = complete_connect_connection(
        state.store.as_ref(),
        state.pipedream()?.as_ref(),
        &user.macro_user_id,
        &body.app_slug,
        body.server_name.as_deref(),
    )
    .await?;

    if let Some(hook) = &state.on_auth_completed {
        hook(record.clone()).await;
    }

    Ok(Json(PipedreamConnectionResponse::from_record(&record)))
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
        (status = 409, body = ErrorResponse),
        (status = 501, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Register a connected account reported by the Pipedream Connect UI.
///
/// Verifies with Pipedream that the account exists and was connected for
/// the authenticated user before persisting anything. An overlaid app is
/// refused with 409: it connects through its own MCP server instead.
#[tracing::instrument(skip_all, err)]
pub async fn complete_connection<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<PipedreamCompleteRequest>,
) -> Result<Json<PipedreamConnectionResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore + ConnectorOverlays,
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    if state.connect_only(&user.macro_user_id).await {
        return Err(PipedreamHandlerErr::ConnectOnly(
            "this account connects apps through Macro Connect, not Pipedream",
        ));
    }
    let record = complete_pipedream_connection(
        state.store.as_ref(),
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
    post,
    path = "/pipedream/mcp/recover",
    tag = "pipedream-mcp",
    operation_id = "recover_pipedream_mcp_connection",
    request_body = PipedreamRecoverRequest,
    responses(
        (status = 200, body = PipedreamConnectionResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 501, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Register an account a Connect flow created but the Connect UI never
/// reported.
///
/// Called after the Connect UI closes without a success event. Answers 404
/// when Pipedream has no new account for this user and app.
/// An overlaid app is refused with 409, as in [`complete_connection`].
#[tracing::instrument(skip_all, err, fields(connector.app_slug = %body.app_slug))]
pub async fn recover_connection<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<PipedreamRecoverRequest>,
) -> Result<Json<PipedreamConnectionResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore + ConnectorOverlays,
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
    anyhow::Error: From<S::Err>,
{
    let user = &authorization.authorization.user;
    if state.connect_only(&user.macro_user_id).await {
        return Err(PipedreamHandlerErr::NotFound);
    }
    let record = recover_pipedream_connection(
        state.store.as_ref(),
        state.store.as_ref(),
        state.pipedream()?.as_ref(),
        &user.macro_user_id,
        &body.app_slug,
        body.server_name.as_deref(),
        chrono::Utc::now(),
    )
    .await?
    .ok_or(PipedreamHandlerErr::NotFound)?;

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
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(params): Query<PipedreamCatalogParams>,
) -> Result<Json<PipedreamCatalogResponse>, PipedreamHandlerErr>
where
    S: ConnectionStore,
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
{
    // Connect's catalog for a user on Connect alone (see the directory).
    let page = browse_catalog(
        state.pipedream()?.as_ref(),
        &authorization.authorization.user.macro_user_id,
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

#[utoipa::path(
    get,
    path = "/pipedream/mcp/overlays",
    tag = "pipedream-mcp",
    operation_id = "list_pipedream_mcp_overlays",
    responses(
        (status = 200, body = Vec<PipedreamOverlayResponse>),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// List the catalog apps that connect through their own MCP server.
///
/// Clients connect these with the native MCP OAuth flow against
/// `server_url`; Pipedream refuses to complete a connection for them.
#[tracing::instrument(skip_all, err)]
pub async fn list_overlays<S, P, Auth>(
    State(state): State<PipedreamRouterState<S, P, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<PipedreamOverlayResponse>>, PipedreamHandlerErr>
where
    S: ConnectionStore + ConnectorOverlays,
    P: PipedreamConnect + ConnectorDirectory + MacroConnect,
    Auth: MacroAuthorizationService,
{
    let mut overlays = state.store.overlays().await?;
    // Connect serves its apps to a user on Connect alone, overlaid or not.
    if let Ok(backends) = state.pipedream()
        && backends
            .connect_only(&authorization.authorization.user.macro_user_id)
            .await
    {
        let mut kept = Vec::with_capacity(overlays.len());
        for overlay in overlays {
            if backends.app_for_slug(&overlay.app_slug).await?.is_none() {
                kept.push(overlay);
            }
        }
        overlays = kept;
    }
    Ok(Json(overlays.into_iter().map(Into::into).collect()))
}
