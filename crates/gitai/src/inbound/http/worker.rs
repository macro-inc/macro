//! The `/worker/*` routes the git-ai client calls, with the response shapes
//! it parses (`src/api/` in git-ai 1.7.7).

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;

use super::{ApiError, Service, api_key, client_headers};
use crate::domain::ports::{IndexStore, IngestMetrics, ObjectStore};
use crate::domain::service::release_download_url;

/// `POST /worker/metrics/upload` → `{"errors":[{"index","error"}]}`. Only
/// malformed events are listed; dropped repositories are not, so the client
/// marks them delivered instead of retrying.
pub(super) async fn metrics_upload<
    Objects: ObjectStore,
    Index: IndexStore,
    Metrics: IngestMetrics,
>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let errors = service
        .ingest_metrics(api_key(&headers), &client_headers(&headers), &body)
        .await?;
    Ok(Json(json!({ "errors": errors })))
}

/// `POST /worker/logs/upload`.
pub(super) async fn logs_upload<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let accepted = service
        .accept_logs(api_key(&headers), &client_headers(&headers), &body)
        .await?;
    Ok(Json(json!({
        "accepted": accepted,
        "dropped": 0,
        "enqueued": true,
        "errors": [],
    })))
}

/// `POST /worker/notes/upload` → `{"success_count","failure_count"}`.
pub(super) async fn notes_upload<
    Objects: ObjectStore,
    Index: IndexStore,
    Metrics: IngestMetrics,
>(
    State(service): State<Service<Objects, Index, Metrics>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let outcome = service
        .upload_notes(api_key(&headers), &client_headers(&headers), &body)
        .await?;
    Ok(Json(outcome))
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
    let notes = service
        .read_notes(api_key(&headers), &client_headers(&headers), &query.commits)
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
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let hashes = service
        .accept_cas(api_key(&headers), &client_headers(&headers), &body)
        .await?;
    let results: Vec<_> = hashes
        .iter()
        .map(|hash| json!({ "hash": hash, "status": "ok" }))
        .collect();
    Ok(Json(json!({
        "results": results,
        "success_count": hashes.len(),
        "failure_count": 0,
    })))
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
    let hashes = service
        .read_cas(api_key(&headers), &client_headers(&headers), &query.hashes)
        .await?;
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
    let channels = service
        .releases(api_key(&headers), &client_headers(&headers))
        .await?;
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
