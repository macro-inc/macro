use std::collections::HashMap;
use std::rc::Rc;

use axum::{
    Extension,
    body::Bytes,
    extract::{Path as AxumPath, Query, Request as AxumRequest, State as AxumState},
    http::{StatusCode, header},
    middleware::{Next, from_fn_with_state},
    response::{IntoResponse, Response as AxumResponse},
    routing::{get, post},
};
use enum_map::{EnumMap, enum_map};
use tracing::error;
use worker::{Error, send::SendWrapper};

use crate::{
    domain::{
        document_id::DocumentId,
        models::GetSnapshotRequest,
        permissions::{AccessLevel, AuthToken},
        ports::{SyncServiceAdmin, SyncServiceCore, SyncServiceError},
    },
    inbound::{
        auth::{Authenticator, WebsocketQueryParams},
        cors::cors_layer,
    },
};

#[cfg(feature = "openapi")]
use crate::domain::models::{BlameRow, DocumentMetadata, PeerResponse};

/// The router's axum state: the [`SyncServiceCore`] port impl, made
/// ownable/`Clone` via `Rc` and `Send`/`Sync` for the worker runtime via
/// `SendWrapper`. Auth is not part of the state — it flows entirely through
/// middleware (see [`do_router`]).
pub type ServiceState<S> = SendWrapper<Rc<S>>;

pub(crate) struct AppError(Error);

impl From<Error> for AppError {
    fn from(e: Error) -> Self {
        Self(e)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self(e.into())
    }
}

impl From<SyncServiceError> for AppError {
    fn from(e: SyncServiceError) -> Self {
        let SyncServiceError::Internal(e) = e;
        Self(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> AxumResponse {
        error!(err =? self.0, "sync-service handler error");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    }
}

pub(crate) type HandlerResult = std::result::Result<AxumResponse, AppError>;

/// Build the per-request axum router for the durable object. Routes are grouped
/// by the access level they require; the [`EnumMap`] is exhaustive over
/// [`AccessLevel`], so every level is accounted for even though some carry no
/// routes. Each tier gets a middleware guard for its level, keyed on the
/// [`Authenticator`] (independent of the service state).
pub fn do_router<S>(service: ServiceState<S>, auth: Authenticator) -> axum::Router
where
    S: SyncServiceCore + SyncServiceAdmin + 'static,
{
    // `connect` self-authenticates from its query token: a dedicated guard
    // decodes it and injects the claims for the handler (401 on failure).
    let connect: axum::Router<ServiceState<S>> = axum::Router::new()
        .route("/document/{document_id}/connect", get(connect_route::<S>))
        .layer(from_fn_with_state(auth.clone(), connect_query_auth));

    // Routes that need no auth.
    let open: axum::Router<ServiceState<S>> = axum::Router::new()
        .route("/document/{document_id}/exists", get(exists_route::<S>))
        .route(
            "/document/{document_id}/peer/{peer_id}",
            get(peer_route::<S>),
        )
        .route("/document/{document_id}/wakeup", post(wakeup_route::<S>))
        .merge(connect);

    let tiers: EnumMap<AccessLevel, axum::Router<ServiceState<S>>> = enum_map! {
        AccessLevel::View => axum::Router::new()
            .route("/document/{document_id}/metadata", get(metadata_route::<S>))
            .route("/document/{document_id}/blame/{node_id}", get(blame_route::<S>))
            .route("/document/{document_id}/raw", get(raw_route::<S>))
            .route("/document/{document_id}/snapshot", post(snapshot_route::<S>))
            .route("/document/{document_id}/active_peers", get(active_peers_route::<S>)),
        AccessLevel::Comment => axum::Router::new(),
        AccessLevel::Edit => axum::Router::new()
            .route("/document/{document_id}/initialize", post(initialize_route::<S>)),
        AccessLevel::Owner => axum::Router::new(),
        AccessLevel::Admin => axum::Router::new()
            .route("/document/{document_id}/debug_dump_operations", get(debug_dump_operations_route::<S>))
            .route("/document/{document_id}/debug_do_kv_get/{key}", get(debug_do_kv_get_route::<S>))
            .route("/document/{document_id}/debug_do_kv_list/{prefix}", get(debug_do_kv_list_route::<S>)),
    };

    tiers
        .into_iter()
        .fold(open, |router, (level, tier)| {
            let guard = from_fn_with_state(
                auth.clone(),
                move |AxumState(auth): AxumState<Authenticator>,
                      AxumPath(params): AxumPath<HashMap<String, String>>,
                      req: AxumRequest,
                      next: Next| async move {
                    let Some(document_id) = params.get("document_id") else {
                        return StatusCode::UNAUTHORIZED.into_response();
                    };
                    let document_id = DocumentId::from(document_id.as_str());
                    if auth.authorize(req.headers(), &document_id, level) {
                        next.run(req).await
                    } else {
                        StatusCode::UNAUTHORIZED.into_response()
                    }
                },
            );
            router.merge(tier.layer(guard))
        })
        .layer(cors_layer())
        .with_state(service)
}

/// Guard for the websocket `connect` route: decodes the query-string token and
/// injects the resulting [`AuthToken`] into request extensions for the handler,
/// or rejects with `401`. Keeps auth entirely in middleware.
async fn connect_query_auth(
    AxumState(auth): AxumState<Authenticator>,
    mut req: AxumRequest,
    next: Next,
) -> AxumResponse {
    let claims = Query::<WebsocketQueryParams>::try_from_uri(req.uri())
        .ok()
        .and_then(|Query(params)| auth.decode_query(&params.token));
    let Some(claims) = claims else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    req.extensions_mut().insert(claims);
    next.run(req).await
}

#[worker::send]
async fn connect_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(document_id): AxumPath<DocumentId>,
    Extension(claims): Extension<AuthToken>,
) -> HandlerResult {
    // The query-token guard only proves the token is valid; it must also grant
    // access to *this* document before we upgrade the connection.
    if !claims.has_document_id_access(&document_id) {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    }
    Ok(state.connect(claims, &document_id).await?.into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/exists", operation_id = "document_exists",
    tag = "sync_service", params(("document_id" = String, Path)),
    responses((status = 200, description = "Document exists"), (status = 404, description = "Not found")),
))]
#[worker::send]
pub(crate) async fn exists_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(document_id): AxumPath<DocumentId>,
) -> HandlerResult {
    let exists = state.exists(&document_id).await?;
    Ok(if exists {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    }
    .into_response())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/metadata", operation_id = "document_metadata",
    tag = "sync_service", params(("document_id" = String, Path)),
    responses((status = 200, body = DocumentMetadata), (status = 401), (status = 404)),
))]
#[worker::send]
pub(crate) async fn metadata_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(document_id): AxumPath<DocumentId>,
) -> HandlerResult {
    Ok(match state.metadata(&document_id).await? {
        Some(v) => axum::Json(v).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    })
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/raw", operation_id = "document_raw",
    tag = "sync_service", params(("document_id" = String, Path)),
    responses((status = 200, description = "Raw document JSON"), (status = 401), (status = 404)),
))]
#[worker::send]
pub(crate) async fn raw_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(document_id): AxumPath<DocumentId>,
) -> HandlerResult {
    Ok(match state.raw(&document_id).await? {
        Some(s) => ([(header::CONTENT_TYPE, "application/json")], s).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    })
}

/// Query params for [`active_peers_route`]. `include_ai=false` (or `0`) filters
/// out AI editors; the default keeps them.
#[derive(serde::Deserialize)]
pub(crate) struct ActivePeersParams {
    include_ai: Option<String>,
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/active_peers", operation_id = "document_active_peers",
    tag = "sync_service",
    params(
        ("document_id" = String, Path),
        ("include_ai" = Option<String>, Query, description = "Set to `false` or `0` to filter out AI editors"),
    ),
    responses((status = 200, description = "Active peer ids"), (status = 401)),
))]
#[worker::send]
pub(crate) async fn active_peers_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(_document_id): AxumPath<DocumentId>,
    Query(params): Query<ActivePeersParams>,
) -> HandlerResult {
    let include_ai = !matches!(params.include_ai.as_deref(), Some("false" | "0"));
    let peers = state.active_peers(include_ai).await?;
    let peers: Vec<String> = peers.iter().map(u64::to_string).collect();
    Ok(axum::Json(peers).into_response())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/blame/{node_id}", operation_id = "document_blame",
    tag = "sync_service",
    params(("document_id" = String, Path), ("node_id" = String, Path)),
    responses((status = 200, body = BlameRow), (status = 401), (status = 404)),
))]
#[worker::send]
pub(crate) async fn blame_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath((document_id, node_id)): AxumPath<(DocumentId, String)>,
) -> HandlerResult {
    Ok(match state.blame(&document_id, &node_id).await? {
        Some(row) => axum::Json(row).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    })
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/peer/{peer_id}", operation_id = "document_peer",
    tag = "sync_service",
    params(("document_id" = String, Path), ("peer_id" = String, Path)),
    responses((status = 200, body = PeerResponse)),
))]
#[worker::send]
pub(crate) async fn peer_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath((document_id, peer_id)): AxumPath<(DocumentId, String)>,
) -> HandlerResult {
    let resp = state.peer(&document_id, &peer_id).await?;
    Ok(axum::Json(resp).into_response())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    post, path = "/document/{document_id}/wakeup", operation_id = "document_wakeup",
    tag = "sync_service", params(("document_id" = String, Path)),
    responses((status = 200, description = "Keepalive scheduled")),
))]
#[worker::send]
pub(crate) async fn wakeup_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(document_id): AxumPath<DocumentId>,
) -> HandlerResult {
    let out = state.wakeup(&document_id).await?;
    Ok(axum::Json(out).into_response())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    post, path = "/document/{document_id}/snapshot", operation_id = "document_snapshot",
    tag = "sync_service", params(("document_id" = String, Path)),
    request_body = GetSnapshotRequest,
    responses((status = 200, description = "Loro snapshot bytes"), (status = 401), (status = 404)),
))]
#[worker::send]
pub(crate) async fn snapshot_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(document_id): AxumPath<DocumentId>,
    body: Bytes,
) -> HandlerResult {
    let request: GetSnapshotRequest = if body.is_empty() {
        GetSnapshotRequest { version_id: None }
    } else {
        serde_json::from_slice(&body)?
    };
    Ok(match state.snapshot(&document_id, request).await? {
        Some(bytes) => {
            ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    })
}

#[cfg_attr(feature = "openapi", utoipa::path(
    post, path = "/document/{document_id}/initialize", operation_id = "document_initialize",
    tag = "sync_service", params(("document_id" = String, Path)),
    responses((status = 200, description = "Initialized"), (status = 401)),
))]
#[worker::send]
pub(crate) async fn initialize_route<S: SyncServiceCore>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(document_id): AxumPath<DocumentId>,
    body: Bytes,
) -> HandlerResult {
    state.initialize(&document_id, body.to_vec()).await?;
    Ok(StatusCode::OK.into_response())
}

#[worker::send]
async fn debug_dump_operations_route<S: SyncServiceAdmin>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath(document_id): AxumPath<DocumentId>,
) -> HandlerResult {
    Ok(match state.dump_operations(&document_id).await? {
        Some(v) => axum::Json(v).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    })
}

#[worker::send]
async fn debug_do_kv_get_route<S: SyncServiceAdmin>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath((_document_id, key)): AxumPath<(DocumentId, String)>,
) -> HandlerResult {
    let value = state.debug_kv_get(&key).await?;
    Ok(axum::Json(value).into_response())
}

#[worker::send]
async fn debug_do_kv_list_route<S: SyncServiceAdmin>(
    AxumState(state): AxumState<ServiceState<S>>,
    AxumPath((_document_id, prefix)): AxumPath<(DocumentId, String)>,
) -> HandlerResult {
    let kvs = state.debug_kv_list(&prefix).await?;
    Ok(axum::Json(kvs).into_response())
}
