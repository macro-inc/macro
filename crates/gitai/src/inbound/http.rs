use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use serde_json::json;

use crate::domain::models::{ClientHeaders, GitaiError};
use crate::domain::ports::{IndexStore, IngestMetrics, ObjectStore};
use crate::domain::service::GitaiService;

mod credentials;
mod worker;

#[cfg(test)]
mod test;

/// Largest request body a `/worker` route accepts. A batch of 1,000 transcript
/// events averages about 5 MB and can be far larger; axum's default is 2 MB.
pub const WORKER_BODY_LIMIT_BYTES: usize = 64 * 1024 * 1024;

/// The header both kinds of key arrive in.
const API_KEY_HEADER: &str = "x-api-key";
const DISTINCT_ID_HEADER: &str = "x-distinct-id";
const CLIENT_USER_AGENT_PREFIX: &str = "git-ai/";

type Service<Objects, Index, Metrics> = Arc<GitaiService<Objects, Index, Metrics>>;

/// The service's routes, without the gateway prefix: `GET /health`, the
/// client-facing `/worker/*` routes and the `/v1/*` API. Anything else,
/// including `/worker/oauth/*` and `/api/*`, is 404.
pub fn router<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>(
    service: Service<Objects, Index, Metrics>,
) -> Router {
    Router::new()
        .route("/health", get(health))
        .nest("/worker", worker_routes())
        .route("/v1/whoami", get(credentials::whoami))
        .route(
            "/v1/credentials",
            post(credentials::mint).get(credentials::list),
        )
        .route("/v1/credentials/{id}", delete(credentials::revoke))
        .with_state(service)
}

/// `GET /health`: 200 while the process runs. It touches no storage, so an
/// S3 or DynamoDB outage does not take the task out of the gateway.
async fn health() -> &'static str {
    "healthy"
}

/// The routes the git-ai client calls. Add each route here, before the body
/// limit: a layer only wraps the routes that exist when it is applied.
fn worker_routes<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics>()
-> Router<Service<Objects, Index, Metrics>> {
    let routes = Router::new()
        .route("/metrics/upload", post(worker::metrics_upload))
        .route("/logs/upload", post(worker::logs_upload))
        .route("/notes/upload", post(worker::notes_upload))
        // The client calls `/worker/notes/?commits=`; the spec allows both.
        .route("/notes", get(worker::notes_read))
        .route("/notes/", get(worker::notes_read))
        .route("/cas/upload", post(worker::cas_upload))
        .route("/cas", get(worker::cas_read))
        .route("/cas/", get(worker::cas_read))
        .route("/releases", get(worker::releases))
        .route(
            "/releases/{channel}/download/{file}",
            get(worker::release_download),
        );
    with_worker_body_limit(routes)
}

fn with_worker_body_limit<State: Clone + Send + Sync + 'static>(
    routes: Router<State>,
) -> Router<State> {
    routes.layer(DefaultBodyLimit::max(WORKER_BODY_LIMIT_BYTES))
}

/// The presented `X-API-Key`, if it is text.
fn api_key(headers: &HeaderMap) -> Option<&str> {
    headers.get(API_KEY_HEADER)?.to_str().ok()
}

/// What the client says about itself. `X-Author-Identity` is not read: the
/// credential decides who the author is.
fn client_headers(headers: &HeaderMap) -> ClientHeaders {
    let text = |name| headers.get(name).and_then(|value| value.to_str().ok());
    ClientHeaders {
        distinct_id: text(DISTINCT_ID_HEADER).map(str::to_owned),
        client_version: text(header::USER_AGENT.as_str())
            .and_then(|agent| agent.strip_prefix(CLIENT_USER_AGENT_PREFIX))
            .map(str::to_owned),
    }
}

/// A use case's error as an HTTP response. Storage failures are 500 so the
/// client retries; nothing here answers 429 or 503, which the client treats
/// as hours of backoff.
pub(crate) struct ApiError(GitaiError);

impl From<GitaiError> for ApiError {
    fn from(error: GitaiError) -> Self {
        Self(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self.0 {
            GitaiError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_owned()),
            GitaiError::NotFound => (StatusCode::NOT_FOUND, "not_found".to_owned()),
            GitaiError::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            GitaiError::Internal(report) => {
                tracing::error!(error = ?report, "gitai request failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal".to_owned())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
