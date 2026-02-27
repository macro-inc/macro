use axum::Router;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use reqwest::StatusCode;
use serde::Deserialize;
use utoipa::ToSchema;

#[derive(Debug, ToSchema, Deserialize)]
pub struct ProxyParams {
    pub url: String,
}

#[utoipa::path(
    get,
    path = "/proxy",
    params(("url" = String, Query, description = "The image url to proxy")),
)]
#[tracing::instrument(err(Debug), skip(http_client))]
pub async fn proxy_request_handler(
    Query(params): Query<ProxyParams>,
    State(http_client): State<reqwest::Client>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    let response = http_client
        .get(&params.url)
        .send()
        .await
        .map_err(|err| (StatusCode::BAD_REQUEST, err.to_string()))?;

    if !response.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("upstream returned status {}", response.status()),
        ));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    Response::builder()
        .header("Content-Type", content_type)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(Body::from_stream(response.bytes_stream()))
        .map_err(|e| {
            tracing::error!(error=?e, "could not stream chunks");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })
}

pub fn router() -> Router<crate::api::context::ApiContext> {
    Router::new().route("/", get(proxy_request_handler))
}

#[cfg(test)]
mod test;
