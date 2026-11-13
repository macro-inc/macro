//! The `/worker/*` routes the git-ai client calls, with the response shapes
//! it parses (`src/api/` in git-ai 1.7.7).

use axum::Json;
use axum::body::Bytes;
use axum::extract::{FromRequest, Path, Query, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;

use super::{ApiError, Service, api_key, client_headers};
use crate::domain::metrics::Endpoint;
use crate::domain::models::{ClientHeaders, DeviceIdentity};
use crate::domain::ports::{IndexStore, IngestMetrics, ObjectStore};
use crate::domain::service::release_download_url;

/// Authenticates the request, then reads its body. A missing, malformed,
/// unknown or revoked key is refused before any of the body is buffered,
/// so only enrolled devices can make the service hold a large body.
async fn authenticated_body<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    service: &Service<Objects, Index, Metrics>,
    endpoint: Endpoint,
    request: Request,
) -> Result<(DeviceIdentity, ClientHeaders, Bytes), Response> {
    let (parts, body) = request.into_parts();
    let headers = client_headers(&parts.headers);
    let identity = service
        .authenticate_client(endpoint, api_key(&parts.headers), &headers)
        .await
        .map_err(ApiError::from)?;
    // `Bytes` honours the route's body limit (413 above it).
    let body = Bytes::from_request(Request::from_parts(parts, body), &())
        .await
        .map_err(IntoResponse::into_response)?;
    Ok((identity, headers, body))
}

/// Authenticates a request that has no body.
async fn authenticated<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    service: &Service<Objects, Index, Metrics>,
    endpoint: Endpoint,
    headers: &HeaderMap,
) -> Result<(DeviceIdentity, ClientHeaders), ApiError> {
    let client = client_headers(headers);
    let identity = service
        .authenticate_client(endpoint, api_key(headers), &client)
        .await?;
    Ok((identity, client))
}

/// `POST /worker/metrics/upload` → `{"errors":[{"index","error"}]}`. Only
/// malformed events are listed; dropped repositories are not, so the client
/// marks them delivered instead of retrying.
pub(super) async fn metrics_upload<
    Objects: ObjectStore,
    Index: IndexStore,
    Metrics: IngestMetrics,
>(
    State(service): State<Service<Objects, Index, Metrics>>,
    request: Request,
) -> Result<Response, Response> {
    let (identity, headers, body) =
        authenticated_body(&service, Endpoint::MetricsUpload, request).await?;
    let errors = service
        .ingest_metrics(&identity, &headers, &body)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "errors": errors })).into_response())
}

/// `POST /worker/logs/upload`.
pub(super) async fn logs_upload<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    request: Request,
) -> Result<Response, Response> {
    let (identity, headers, body) =
        authenticated_body(&service, Endpoint::LogsUpload, request).await?;
    let accepted = service
        .accept_logs(&identity, &headers, &body)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({
        "accepted": accepted,
        "dropped": 0,
        "enqueued": true,
        "errors": [],
    }))
    .into_response())
}

/// `POST /worker/notes/upload` → `{"success_count","failure_count"}`.
pub(super) async fn notes_upload<
    Objects: ObjectStore,
    Index: IndexStore,
    Metrics: IngestMetrics,
>(
    State(service): State<Service<Objects, Index, Metrics>>,
    request: Request,
) -> Result<Response, Response> {
    let (identity, headers, body) =
        authenticated_body(&service, Endpoint::NotesUpload, request).await?;
    let outcome = service
        .upload_notes(&identity, &headers, &body)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(outcome).into_response())
}

#[derive(Deserialize)]
pub(super) struct NotesQuery {
    #[serde(default)]
    commits: String,
}

/// `GET /worker/notes/?commits=a,b` → `{"notes":{sha: note}}`, 404 with an
/// empty map when none is known (the client reads 404 as empty).
pub(super) async fn notes_read<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
    Query(query): Query<NotesQuery>,
) -> Result<Response, ApiError> {
    let (identity, headers) = authenticated(&service, Endpoint::NotesRead, &headers).await?;
    let notes = service
        .read_notes(&identity, &headers, &query.commits)
        .await?;
    let status = if notes.is_empty() {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::OK
    };
    Ok((status, Json(json!({ "notes": notes }))).into_response())
}

/// `POST /worker/cas/upload`: acknowledged, not stored.
pub(super) async fn cas_upload<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    request: Request,
) -> Result<Response, Response> {
    let (identity, headers, body) =
        authenticated_body(&service, Endpoint::CasUpload, request).await?;
    let hashes = service
        .accept_cas(&identity, &headers, &body)
        .await
        .map_err(ApiError::from)?;
    let results: Vec<_> = hashes
        .iter()
        .map(|hash| json!({ "hash": hash, "status": "ok" }))
        .collect();
    Ok(Json(json!({
        "results": results,
        "success_count": hashes.len(),
        "failure_count": 0,
    }))
    .into_response())
}

#[derive(Deserialize)]
pub(super) struct CasQuery {
    #[serde(default)]
    hashes: String,
}

/// `GET /worker/cas/?hashes=`: every hash is reported missing.
pub(super) async fn cas_read<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
    Query(query): Query<CasQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let (identity, headers) = authenticated(&service, Endpoint::CasRead, &headers).await?;
    let hashes = service.read_cas(&identity, &headers, &query.hashes).await?;
    let results: Vec<_> = hashes
        .iter()
        .map(|hash| json!({ "hash": hash, "status": "error", "error": "not found" }))
        .collect();
    Ok(Json(json!({
        "results": results,
        "success_count": 0,
        "failure_count": hashes.len(),
    })))
}

/// `GET /worker/releases` → `{"channels":{name:{version,checksum}}}`.
pub(super) async fn releases<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let (identity, headers) = authenticated(&service, Endpoint::Releases, &headers).await?;
    let channels = service.releases(&identity, &headers).await?;
    Ok(Json(json!({ "channels": channels })))
}

/// `GET /worker/releases/{channel}/download/{file}` → 302 to the pinned
/// GitHub release asset. No credential: the client sends none here.
pub(super) async fn release_download(
    Path((channel, file)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let location = release_download_url(&channel, &file)?;
    Ok((StatusCode::FOUND, [(header::LOCATION, location)]).into_response())
}
