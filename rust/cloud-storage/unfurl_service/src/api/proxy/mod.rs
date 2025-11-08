use axum::Router;
use axum::body::Body;
use axum::extract::Query;
use axum::http::Request;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use reqwest::{self, StatusCode};
use serde::Deserialize;
use std::collections::HashSet;
use utoipa::{self, ToSchema};

#[derive(Debug, ToSchema, Deserialize)]
pub struct ProxyParams {
    pub url: String,
}

#[utoipa::path(
  get,
  path="/proxy",
  params(("url" = String, Query, description = "The url to proxy from")),
)]
#[tracing::instrument]
pub async fn proxy_request_handler(
    Query(params): Query<ProxyParams>,
    request: Request<Body>,
) -> Result<impl IntoResponse, impl IntoResponse> {
    let client = reqwest::Client::new();
    let excluded_headers: HashSet<&str> = [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    ]
    .into_iter()
    .collect();

    // Build proxied request with forwarded headers
    let mut req_builder = client.get(&params.url);
    for (key, value) in request.headers().iter() {
        if !excluded_headers.contains(key.as_str()) {
            req_builder = req_builder.header(key, value);
        }
    }
    let response = req_builder
        .send()
        .await
        .map_err(|err| (StatusCode::BAD_REQUEST, err.to_string()))?;

    let mut response_builder = Response::builder().status(response.status());

    for (header, value) in response.headers() {
        response_builder = response_builder.header(header, value);
    }
    response_builder
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(Body::from_stream(response.bytes_stream()))
        .map_err(|e| {
            tracing::error!(error=?e, "could not stream chunks");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })
}

pub fn router() -> Router {
    Router::new().route("/", get(proxy_request_handler))
}
