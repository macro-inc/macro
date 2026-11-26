//! `/connectors`: what the web shows and changes about a user's connections.
//!
//! Every answer is the service's: which apps and servers a user holds, with
//! their status as the rules decide it. Nothing here says which source holds
//! a connection or picks how to connect one; the service answers with the
//! [`ConnectStep`](crate::domain::models::ConnectStep) to take.

use crate::domain::discovery::ConnectorCatalogService;
use crate::domain::models::{AddedBy, ConnectorKey, ConnectorsError, ServerUrl};
use crate::domain::service::ConnectionManagementService;
use crate::inbound::dto::{
    AddServerRequest, CatalogPageResponse, CatalogParams, ConnectStepResponse, ConnectorPath,
    ConnectorResponse, Importable, InvalidKey, UpdateConnectorRequest,
};
use crate::inbound::{ConnectorHook, fire};
use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// What the `/connectors` routes run on.
pub struct ConnectorsRouterState<S, C, Auth> {
    connectors: Arc<S>,
    catalog: Arc<C>,
    authorization_state: MacroAuthorizationState<Auth>,
    importable: Arc<Importable>,
    on_connected: Option<ConnectorHook>,
    on_removed: Option<ConnectorHook>,
}

impl<S, C, Auth> Clone for ConnectorsRouterState<S, C, Auth> {
    fn clone(&self) -> Self {
        Self {
            connectors: self.connectors.clone(),
            catalog: self.catalog.clone(),
            authorization_state: self.authorization_state.clone(),
            importable: self.importable.clone(),
            on_connected: self.on_connected.clone(),
            on_removed: self.on_removed.clone(),
        }
    }
}

impl<S, C, Auth> FromRef<ConnectorsRouterState<S, C, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ConnectorsRouterState<S, C, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<S, C, Auth> ConnectorsRouterState<S, C, Auth>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
{
    /// The routes over the connection services and the catalog. No app is
    /// importable until [`with_importable`](Self::with_importable).
    pub fn new(
        connectors: S,
        catalog: C,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            connectors: Arc::new(connectors),
            catalog: Arc::new(catalog),
            authorization_state,
            importable: Arc::new(Importable::new()),
            on_connected: None,
            on_removed: None,
        }
    }

    /// The apps Macro can import from, which each listed connector reports
    /// as `importAvailable` when its connection provides what the import
    /// reads.
    pub fn with_importable(mut self, importable: Importable) -> Self {
        self.importable = Arc::new(importable);
        self
    }

    /// Run `hook` when a user finishes connecting an app.
    pub fn with_connected_hook(mut self, hook: ConnectorHook) -> Self {
        self.on_connected = Some(hook);
        self
    }

    /// Run `hook` when a user removes a connection.
    pub fn with_removed_hook(mut self, hook: ConnectorHook) -> Self {
        self.on_removed = Some(hook);
        self
    }
}

/// The authenticated `/connectors` routes.
pub fn connectors_router<S, C, Auth, Global>(
    state: ConnectorsRouterState<S, C, Auth>,
) -> Router<Global>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
    Global: Send + Sync,
{
    Router::new()
        .route(
            "/connectors",
            get(list_connectors::<S, C, Auth>).post(add_server::<S, C, Auth>),
        )
        .route("/connectors/catalog", get(browse_catalog::<S, C, Auth>))
        .route(
            "/connectors/{kind}/{id}",
            axum::routing::patch(update_connector::<S, C, Auth>)
                .delete(remove_connector::<S, C, Auth>),
        )
        .route(
            "/connectors/{kind}/{id}/connect",
            post(start_connect::<S, C, Auth>),
        )
        .route(
            "/connectors/{kind}/{id}/complete",
            post(complete_connect::<S, C, Auth>),
        )
        .with_state(state)
}

/// Why a `/connectors` request failed.
#[derive(Debug, thiserror::Error)]
pub enum ConnectorsHttpError {
    /// The path names no app or server.
    #[error("invalid connector key: {0}")]
    InvalidKey(#[from] InvalidKey),
    /// The request is malformed.
    #[error("{0}")]
    InvalidRequest(String),
    /// The service refused or failed.
    #[error(transparent)]
    Service(#[from] ConnectorsError),
}

impl IntoResponse for ConnectorsHttpError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::InvalidKey(_) | Self::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            Self::Service(error) => match error {
                ConnectorsError::UnknownApp(_) | ConnectorsError::NotFound(_) => {
                    StatusCode::NOT_FOUND
                }
                ConnectorsError::NeedsReauth(_) => StatusCode::CONFLICT,
                ConnectorsError::NonPublicServer(_) | ConnectorsError::EmptyName => {
                    StatusCode::BAD_REQUEST
                }
                ConnectorsError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            },
        };
        // An internal report can carry a vendor's answer or a stored URL;
        // the caller gets a plain message and the report stays in the trace.
        let message = match &self {
            Self::Service(ConnectorsError::Internal(_)) => {
                "the connectors service failed".to_owned()
            }
            other => other.to_string(),
        };

        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

#[utoipa::path(
    get,
    path = "/connectors",
    tag = "connectors",
    operation_id = "list_connectors",
    responses(
        (status = 200, body = Vec<ConnectorResponse>),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// Every app and server the user holds, with where they stand with it. A
/// connection that no longer counts shows as `notConnected`.
#[tracing::instrument(skip_all, err)]
pub async fn list_connectors<S, C, Auth>(
    State(state): State<ConnectorsRouterState<S, C, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<ConnectorResponse>>, ConnectorsHttpError>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user.macro_user_id;
    let connectors = state.connectors.list(user).await?;

    Ok(Json(
        connectors
            .iter()
            .map(|connector| ConnectorResponse::new(connector, &state.importable))
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/connectors",
    tag = "connectors",
    operation_id = "add_connector_server",
    request_body = AddServerRequest,
    responses(
        (status = 201, body = ConnectorResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// Add a server by URL, enabled and not yet signed in to. A URL the user
/// already has is answered as it stands. A server at an app's address is
/// that app.
#[tracing::instrument(skip_all, err)]
pub async fn add_server<S, C, Auth>(
    State(state): State<ConnectorsRouterState<S, C, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<AddServerRequest>,
) -> Result<(StatusCode, Json<ConnectorResponse>), ConnectorsHttpError>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user.macro_user_id;
    let url = ServerUrl::parse(&body.url)
        .map_err(|error| ConnectorsHttpError::InvalidRequest(error.to_string()))?;
    let connector = state
        .connectors
        .add_server(user, url, &body.name, AddedBy::User)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(ConnectorResponse::new(&connector, &state.importable)),
    ))
}

#[utoipa::path(
    get,
    path = "/connectors/catalog",
    tag = "connectors",
    operation_id = "browse_connector_catalog",
    params(CatalogParams),
    responses(
        (status = 200, body = CatalogPageResponse),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// Browse or search the apps the user can connect, most popular first.
#[tracing::instrument(skip_all, err)]
pub async fn browse_catalog<S, C, Auth>(
    State(state): State<ConnectorsRouterState<S, C, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(params): Query<CatalogParams>,
) -> Result<Json<CatalogPageResponse>, ConnectorsHttpError>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user.macro_user_id;
    let page = state
        .catalog
        .search(
            user,
            params.search.as_deref(),
            params.cursor.as_deref(),
            params.limit,
        )
        .await?;

    Ok(Json(CatalogPageResponse {
        apps: page.apps.into_iter().map(Into::into).collect(),
        next_cursor: page.next_cursor,
    }))
}

#[utoipa::path(
    post,
    path = "/connectors/{kind}/{id}/connect",
    tag = "connectors",
    operation_id = "start_connector_connect",
    params(ConnectorPath),
    responses(
        (status = 200, body = ConnectStepResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Begin connecting an app, or signing in to a server added by URL. Answers
/// the step the user takes next.
#[tracing::instrument(skip_all, err)]
pub async fn start_connect<S, C, Auth>(
    State(state): State<ConnectorsRouterState<S, C, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<ConnectorPath>,
) -> Result<Json<ConnectStepResponse>, ConnectorsHttpError>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user.macro_user_id;
    let key = path.key()?;
    let step = state.connectors.start_connect(user, &key).await?;

    Ok(Json(step.into()))
}

#[utoipa::path(
    post,
    path = "/connectors/{kind}/{id}/complete",
    tag = "connectors",
    operation_id = "complete_connector_connect",
    params(ConnectorPath),
    responses(
        (status = 200, body = ConnectorResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse, description = "Not connected yet; poll again while the connect page is open"),
        (status = 500, body = ErrorResponse),
    )
)]
/// Record the connection the user just finished making, once the connect
/// page or dialog is done. Answers 404 until it exists, so it can be polled.
/// A server added by URL finishes on its OAuth callback; this answers it as
/// it stands.
#[tracing::instrument(skip_all, err)]
pub async fn complete_connect<S, C, Auth>(
    State(state): State<ConnectorsRouterState<S, C, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<ConnectorPath>,
) -> Result<Json<ConnectorResponse>, ConnectorsHttpError>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user.macro_user_id;
    let key = path.key()?;
    let connector = match &key {
        ConnectorKey::App(app) => {
            let connector = state.connectors.complete_connect(user, app).await?;
            fire(
                state.on_connected.as_ref(),
                user,
                std::slice::from_ref(connector.key()),
            )
            .await;
            connector
        }
        ConnectorKey::Server(_) => state
            .connectors
            .list(user)
            .await?
            .into_iter()
            .find(|connector| *connector.key() == key)
            .ok_or(ConnectorsError::NotFound(key))?,
    };

    Ok(Json(ConnectorResponse::new(&connector, &state.importable)))
}

#[utoipa::path(
    patch,
    path = "/connectors/{kind}/{id}",
    tag = "connectors",
    operation_id = "update_connector",
    params(ConnectorPath),
    request_body = UpdateConnectorRequest,
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Turn a connection on or off, or rename it.
#[tracing::instrument(skip_all, err)]
pub async fn update_connector<S, C, Auth>(
    State(state): State<ConnectorsRouterState<S, C, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<ConnectorPath>,
    Json(body): Json<UpdateConnectorRequest>,
) -> Result<StatusCode, ConnectorsHttpError>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user.macro_user_id;
    let key = path.key()?;
    if body.enabled.is_none() && body.name.is_none() {
        return Err(ConnectorsHttpError::InvalidRequest(
            "set `enabled`, `name`, or both".to_owned(),
        ));
    }

    if let Some(name) = &body.name {
        state.connectors.rename(user, &key, name).await?;
    }
    if let Some(enabled) = body.enabled {
        state.connectors.set_enabled(user, &key, enabled).await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/connectors/{kind}/{id}",
    tag = "connectors",
    operation_id = "remove_connector",
    params(ConnectorPath),
    responses(
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = String),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
/// Remove a connection, revoking it where its provider can. Removing GitHub
/// unlinks the account.
#[tracing::instrument(skip_all, err)]
pub async fn remove_connector<S, C, Auth>(
    State(state): State<ConnectorsRouterState<S, C, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<ConnectorPath>,
) -> Result<StatusCode, ConnectorsHttpError>
where
    S: ConnectionManagementService,
    C: ConnectorCatalogService,
    Auth: MacroAuthorizationService,
{
    let user = &authorization.authorization.user.macro_user_id;
    let key = path.key()?;
    state.connectors.remove(user, &key).await?;
    fire(state.on_removed.as_ref(), user, std::slice::from_ref(&key)).await;

    Ok(StatusCode::NO_CONTENT)
}
