use axum::Router;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::Request;
use axum::response::Response;
use axum::routing::get;
use serde::Deserialize;
use std::collections::HashSet;
use utoipa::{self, ToSchema};

use crate::http_safety::{
    FetchError, apply_size_limit, assert_not_internal, build_error_chain, check_content_length,
    validate_url,
};

/// 2 MB max proxied response size.
const MAX_RESPONSE_SIZE: u64 = 2 * 1024 * 1024;

#[derive(Debug, ToSchema, Deserialize)]
pub struct ProxyParams {
    pub url: String,
}

#[utoipa::path(
  get,
  path="/proxy",
  params(("url" = String, Query, description = "The url to proxy from")),
)]
#[tracing::instrument(err(Debug), skip(http_client, request))]
pub async fn proxy_request_handler(
    Query(params): Query<ProxyParams>,
    State(http_client): State<reqwest::Client>,
    request: Request<Body>,
) -> Result<Response, FetchError> {
    let validated_url = validate_url(&params.url)?;
    assert_not_internal(&validated_url).await?;

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

    let mut req_builder = http_client.get(validated_url.as_str());
    for (key, value) in request.headers().iter() {
        if !excluded_headers.contains(key.as_str()) {
            req_builder = req_builder.header(key, value);
        }
    }

    let response = req_builder.send().await.map_err(|e| {
        let error_chain = build_error_chain(&e);
        tracing::warn!(url = %validated_url, error = %error_chain, "upstream proxy request failed");
        if e.is_timeout() {
            FetchError::UpstreamTimeout(error_chain)
        } else if e.is_connect() {
            FetchError::UpstreamConnect(error_chain)
        } else if e.is_redirect() {
            FetchError::UpstreamRedirect(error_chain)
        } else {
            FetchError::UpstreamNetwork(error_chain)
        }
    })?;

    if !response.status().is_success() {
        return Err(FetchError::UpstreamStatus(response.status()));
    }

    check_content_length(&response, MAX_RESPONSE_SIZE, &params.url)?;

    let status = response.status();
    let mut response_builder = Response::builder().status(status);
    for (header, value) in response.headers() {
        response_builder = response_builder.header(header, value);
    }

    let size_limited = apply_size_limit(
        response.bytes_stream(),
        MAX_RESPONSE_SIZE,
        params.url.clone(),
    );

    response_builder
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(Body::from_stream(size_limited))
        .map_err(|e| {
            tracing::error!(error=?e, "could not stream chunks");
            FetchError::ResponseBuild(e)
        })
}

pub fn router() -> Router<crate::api::context::ApiContext> {
    Router::new().route("/", get(proxy_request_handler))
}
