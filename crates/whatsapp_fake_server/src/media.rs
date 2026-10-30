//! The media host: uploads land in memory and downloads read them back,
//! over plain HTTP on a local port.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};

use crate::Shared;

/// The router: `POST /mms/{type}/{token}` uploads (also with a
/// `newsletter`/other prefix), `GET /v/{id}` downloads.
pub(crate) fn router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/{prefix}/{media_type}/{token}", post(upload))
        .route("/v/fake/{id}", get(download))
        .with_state(shared)
}

async fn upload(
    State(shared): State<Arc<Shared>>,
    Path((_prefix, _media_type, _token)): Path<(String, String, String)>,
    body: Bytes,
) -> Response {
    let id = crate::stanza::random_id();
    let direct_path = format!("/v/fake/{id}?ccb=11-4");
    shared.lock().media.insert(id, body.to_vec());
    let url = format!("http://{}{direct_path}", shared.media_host());
    axum::Json(serde_json::json!({ "url": url, "direct_path": direct_path })).into_response()
}

async fn download(State(shared): State<Arc<Shared>>, Path(id): Path<String>) -> Response {
    match shared.lock().media.get(&id) {
        Some(data) => data.clone().into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
