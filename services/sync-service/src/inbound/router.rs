//! HTTP routing and route-specific access requirements for sessions.
#[cfg(feature = "openapi")]
use super::durable_object::document_api::{SnapshotResponse, UpdateRequest, UpdateResponse};
#[cfg(feature = "openapi")]
use crate::domain::models::{BlameRow, DocumentMetadata, GetSnapshotRequest, PeerResponse};
#[cfg(feature = "openapi")]
use crate::swagger::BinaryBody;

use std::{collections::HashMap, rc::Rc};

use axum::{
    Router,
    extract::{Path, Query, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use worker::send::SendWrapper;

use super::{
    auth::{
        AdminAccess, EditAccess, InternalAccess, SignedDocumentAccess, SocketAccess, SurfaceAccess,
        ViewAccess,
    },
    durable_object::SyncSession,
};
use crate::secrets::Secrets;

/// The runtime session is confined to one worker isolate; only Axum's type
/// bounds require Send/Sync. Secrets are extracted once per request.
#[derive(Clone)]
pub struct RouterState {
    pub session: SendWrapper<Rc<SyncSession>>,
    pub secrets: Secrets,
}

pub struct AppError(worker::Error);

impl From<worker::Error> for AppError {
    fn from(error: worker::Error) -> Self {
        Self(error)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        tracing::error!(error = ?self.0, "sync request failed");
        StatusCode::INTERNAL_SERVER_ERROR.into_response()
    }
}

pub type HandlerResult = Result<Response, AppError>;

pub fn document_router(session: Rc<SyncSession>) -> Router {
    let secrets = session.secrets();
    Router::new()
        .route("/document/{document_id}/connect", get(connect))
        .route("/document/{document_id}/exists", get(exists))
        .route("/document/{document_id}/peer/{peer_id}", get(peer))
        .route("/document/{document_id}/wakeup", get(wakeup).post(wakeup))
        .route("/document/{document_id}/metadata", get(metadata))
        .route("/document/{document_id}/blame/{node_id}", get(blame))
        .route("/document/{document_id}/raw", get(raw))
        .route(
            "/document/{document_id}/snapshot",
            get(snapshot).post(snapshot),
        )
        .route("/document/{document_id}/active_peers", get(active_peers))
        .route("/document/{document_id}/initialize", post(initialize))
        .route("/document/{document_id}/state", get(document_state))
        .route("/document/{document_id}/update", post(document_update))
        .route("/document/{document_id}/delete", delete(delete_document))
        .route(
            "/document/{document_id}/debug_dump_operations",
            get(dump_operations),
        )
        .route(
            "/document/{document_id}/debug_do_kv_get/{key}",
            get(debug_get),
        )
        .route(
            "/document/{document_id}/debug_do_kv_list/{prefix}",
            get(debug_list),
        )
        .route(
            "/document/{document_id}/migration/{operation}",
            post(source_migration),
        )
        .route("/surface/{surface_id}/connect", get(surface_connect))
        .route("/surface/{surface_id}/exists", get(surface_read))
        .route("/surface/{surface_id}/active_peers", get(surface_read))
        .route("/surface/{surface_id}/peer/{peer_id}", get(surface_read))
        .route("/surface/{surface_id}/snapshot", post(surface_read))
        .route("/surface/{surface_id}/initialize", post(surface_manage))
        .route("/surface/{surface_id}/revoke", post(surface_manage))
        .route(
            "/surface/{surface_id}/initialize_verified",
            post(surface_manage),
        )
        .route("/surface/{surface_id}/import", post(surface_manage))
        .route("/surface/{surface_id}/verify", post(surface_manage))
        .route("/surface/{surface_id}/activate", post(surface_manage))
        .with_state(RouterState {
            session: SendWrapper::new(session),
            secrets,
        })
}

#[worker::send]
async fn connect(State(state): State<RouterState>, access: SocketAccess) -> HandlerResult {
    Ok(state
        .session
        .connect(access.claims, &access.document_id)
        .await?
        .into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/exists", operation_id = "document_exists",
    tag = "sync_service", params(("document_id" = String, Path)),
    responses((status = 200, description = "Document exists"), (status = 404, description = "Not found")),
))]
#[worker::send]
pub(crate) async fn exists(
    State(state): State<RouterState>,
    Path(id): Path<String>,
) -> HandlerResult {
    Ok(state.session.exists_handler(&id).await?.into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/peer/{peer_id}", operation_id = "document_peer",
    tag = "sync_service",
    params(("document_id" = String, Path), ("peer_id" = String, Path)),
    responses((status = 200, body = PeerResponse)),
))]
#[worker::send]
pub(crate) async fn peer(
    State(state): State<RouterState>,
    Path((id, peer)): Path<(String, String)>,
) -> HandlerResult {
    Ok(state.session.peer_handler(&id, Some(&peer)).await?.into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/wakeup", operation_id = "document_wakeup",
    tag = "sync_service", params(("document_id" = String, Path)),
    responses((status = 200, description = "Keepalive scheduled")),
))]
#[worker::send]
pub(crate) async fn wakeup(
    State(state): State<RouterState>,
    Path(id): Path<String>,
) -> HandlerResult {
    Ok(state.session.wakeup(&id).await?.into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/metadata", operation_id = "document_metadata",
    tag = "sync_service", params(("document_id" = String, Path)),
    security(("document_permission" = []), ("internal_key" = [])),
    responses((status = 200, body = DocumentMetadata), (status = 401), (status = 404)),
))]
#[worker::send]
pub(crate) async fn metadata(
    State(state): State<RouterState>,
    access: ViewAccess,
) -> HandlerResult {
    Ok(state
        .session
        .metadata_handler(&access.document_id)
        .await?
        .into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/blame/{node_id}", operation_id = "document_blame",
    tag = "sync_service",
    params(("document_id" = String, Path), ("node_id" = String, Path)),
    security(("document_permission" = []), ("internal_key" = [])),
    responses((status = 200, body = BlameRow), (status = 401), (status = 404)),
))]
#[worker::send]
pub(crate) async fn blame(
    State(state): State<RouterState>,
    _: ViewAccess,
    Path((_, node)): Path<(String, String)>,
) -> HandlerResult {
    Ok(state.session.blame_handler(Some(&node)).await?.into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/raw", operation_id = "document_raw",
    tag = "sync_service", params(("document_id" = String, Path)),
    security(("document_permission" = []), ("internal_key" = [])),
    responses((status = 200, description = "Raw document JSON"), (status = 401), (status = 404)),
))]
#[worker::send]
pub(crate) async fn raw(State(state): State<RouterState>, access: ViewAccess) -> HandlerResult {
    Ok(state.session.raw_handler(&access.document_id).await?.into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    post, path = "/document/{document_id}/snapshot", operation_id = "document_snapshot",
    tag = "sync_service", params(("document_id" = String, Path)),
    request_body = GetSnapshotRequest,
    security(("document_permission" = []), ("internal_key" = [])),
    responses((status = 200, body = BinaryBody, content_type = "application/octet-stream", description = "Loro snapshot bytes"), (status = 400), (status = 401), (status = 404)),
))]
#[worker::send]
pub(crate) async fn snapshot(
    State(state): State<RouterState>,
    access: ViewAccess,
    req: Request,
) -> HandlerResult {
    Ok(state
        .session
        .snapshot_handler(worker::Request::try_from(req)?, &access.document_id)
        .await?
        .into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/active_peers", operation_id = "document_active_peers",
    tag = "sync_service",
    params(
        ("document_id" = String, Path),
        ("include_ai" = Option<String>, Query, description = "Set to `false` or `0` to filter out AI editors"),
    ),
    security(("document_permission" = []), ("internal_key" = [])),
    responses((status = 200, body = Vec<String>, description = "Active peer ids"), (status = 401)),
))]
#[worker::send]
pub(crate) async fn active_peers(
    State(state): State<RouterState>,
    _: ViewAccess,
    Query(params): Query<HashMap<String, String>>,
) -> HandlerResult {
    let include_ai = !matches!(
        params.get("include_ai").map(String::as_str),
        Some("false" | "0")
    );
    Ok(state
        .session
        .active_peer_ids_handler(include_ai)
        .await?
        .into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    post, path = "/document/{document_id}/initialize", operation_id = "document_initialize",
    tag = "sync_service", params(("document_id" = String, Path)),
    request_body(content = BinaryBody, content_type = "application/octet-stream"),
    security(("document_permission" = []), ("internal_key" = [])),
    responses((status = 200, description = "Initialized"), (status = 401)),
))]
#[worker::send]
pub(crate) async fn initialize(
    State(state): State<RouterState>,
    access: EditAccess,
    req: Request,
) -> HandlerResult {
    Ok(state
        .session
        .initialize_handler(worker::Request::try_from(req)?, &access.document_id)
        .await?
        .into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    get, path = "/document/{document_id}/state", operation_id = "document_state",
    tag = "sync_service", params(("document_id" = String, Path), ("shallow" = Option<bool>, Query, description = "Return current state without prior edit history")),
    security(("document_permission" = [])),
    responses((status = 200, body = SnapshotResponse), (status = 401), (status = 403), (status = 404)),
))]
#[worker::send]
pub(crate) async fn document_state(
    State(state): State<RouterState>,
    access: SignedDocumentAccess,
    req: Request,
) -> HandlerResult {
    Ok(state
        .session
        .document_handler(
            worker::Request::try_from(req)?,
            &access.document_id,
            false,
            access.access,
            access.claims,
        )
        .await?
        .into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    post, path = "/document/{document_id}/update", operation_id = "document_update",
    tag = "sync_service", params(("document_id" = String, Path)),
    request_body = UpdateRequest,
    security(("document_permission" = [])),
    responses((status = 200, body = UpdateResponse), (status = 401), (status = 403), (status = 404), (status = 400), (status = 409), (status = 413), (status = 503), (status = 500)),
))]
#[worker::send]
pub(crate) async fn document_update(
    State(state): State<RouterState>,
    access: SignedDocumentAccess,
    req: Request,
) -> HandlerResult {
    Ok(state
        .session
        .document_handler(
            worker::Request::try_from(req)?,
            &access.document_id,
            true,
            access.access,
            access.claims,
        )
        .await?
        .into())
}

#[cfg_attr(feature = "openapi", utoipa::path(
    delete, path = "/document/{document_id}/delete", operation_id = "document_delete",
    tag = "sync_service", params(("document_id" = String, Path)),
    security(("internal_key" = [])),
    responses((status = 200), (status = 401), (status = 403), (status = 404)),
))]
#[worker::send]
pub(crate) async fn delete_document(
    State(state): State<RouterState>,
    _: InternalAccess,
    Path(id): Path<String>,
) -> HandlerResult {
    Ok(state.session.delete_handler(&id).await?.into())
}

#[worker::send]
async fn dump_operations(State(state): State<RouterState>, access: AdminAccess) -> HandlerResult {
    Ok(state
        .session
        .dump_operations(&access.document_id)
        .await?
        .into())
}

#[worker::send]
async fn debug_get(
    State(state): State<RouterState>,
    _: AdminAccess,
    Path((_, key)): Path<(String, String)>,
) -> HandlerResult {
    Ok(state.session.debug_get(&key).await?.into())
}

#[worker::send]
async fn debug_list(
    State(state): State<RouterState>,
    _: AdminAccess,
    Path((_, prefix)): Path<(String, String)>,
) -> HandlerResult {
    Ok(state.session.debug_list(&prefix).await?.into())
}

impl axum::extract::FromRef<RouterState> for Secrets {
    fn from_ref(state: &RouterState) -> Self {
        state.secrets.clone()
    }
}

#[worker::send]
async fn surface_connect(
    State(state): State<RouterState>,
    access: SurfaceAccess<true>,
    req: Request,
) -> HandlerResult {
    Ok(state
        .session
        .surface_handler(worker::Request::try_from(req)?, Some(access.claims))
        .await?
        .into())
}

#[worker::send]
async fn surface_read(
    State(state): State<RouterState>,
    access: SurfaceAccess<false>,
    req: Request,
) -> HandlerResult {
    Ok(state
        .session
        .surface_handler(worker::Request::try_from(req)?, Some(access.claims))
        .await?
        .into())
}

#[worker::send]
async fn surface_manage(
    State(state): State<RouterState>,
    _: InternalAccess,
    req: Request,
) -> HandlerResult {
    Ok(state
        .session
        .surface_handler(worker::Request::try_from(req)?, None)
        .await?
        .into())
}

#[worker::send]
async fn source_migration(
    State(state): State<RouterState>,
    _: InternalAccess,
    Path((id, operation)): Path<(String, String)>,
    req: Request,
) -> HandlerResult {
    Ok(state
        .session
        .source_migration_handler(worker::Request::try_from(req)?, &id, &operation)
        .await?
        .into())
}
