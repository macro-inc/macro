use axum::Router;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderName, Request};
use axum::response::Response;
use axum::routing::get;
use serde::Deserialize;
use utoipa::{self, ToSchema};

use crate::http_safety::{
    FetchError, MAX_REDIRECTS, SsrfSafeHttpClient, apply_size_limit, assert_not_internal,
    build_error_chain, check_content_length, redirect_target, validate_url,
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
    State(http_client): State<SsrfSafeHttpClient>,
    request: Request<Body>,
) -> Result<Response, FetchError> {
    let validated_url = validate_url(&params.url)?;
    let forwarded_headers = forwarded_request_headers(request.headers());
    let response = fetch_upstream(http_client.as_ref(), validated_url, &forwarded_headers).await?;

    check_content_length(&response, MAX_RESPONSE_SIZE, &params.url)?;

    let status = response.status();
    let response_headers = response.headers().clone();
    let mut response_builder = Response::builder().status(status);
    for (header, value) in response_headers.iter() {
        if is_allowed_response_header(header) {
            response_builder = response_builder.header(header, value);
        }
    }

    let size_limited = apply_size_limit(
        response.bytes_stream(),
        MAX_RESPONSE_SIZE,
        params.url.clone(),
    );

    response_builder
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from_stream(size_limited))
        .map_err(|e| {
            tracing::error!(error=?e, "could not stream chunks");
            FetchError::ResponseBuild(e)
        })
}

async fn fetch_upstream(
    http_client: &reqwest::Client,
    mut url: url::Url,
    headers: &HeaderMap,
) -> Result<reqwest::Response, FetchError> {
    let mut redirects_remaining = MAX_REDIRECTS;

    loop {
        assert_not_internal(&url).await?;
        let response = http_client
            .get(url.as_str())
            .headers(headers.clone())
            .send()
            .await
            .map_err(|e| {
                let error_chain = build_error_chain(&e);
                tracing::warn!(url = %url, error = %error_chain, "upstream proxy request failed");
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
        let status = response.status();

        if status.is_redirection() {
            if redirects_remaining == 0 {
                return Err(FetchError::UpstreamRedirect(format!(
                    "exceeded maximum of {MAX_REDIRECTS} redirects"
                )));
            }
            let next = redirect_target(&url, &response)?;
            tracing::debug!(from = %url, to = %next, "following proxy redirect");
            redirects_remaining -= 1;
            url = next;
            continue;
        }

        if !status.is_success() {
            return Err(FetchError::UpstreamStatus(status));
        }

        return Ok(response);
    }
}

fn forwarded_request_headers(headers: &HeaderMap) -> HeaderMap {
    headers
        .iter()
        .filter(|(name, _)| is_allowed_request_header(name))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect()
}

fn is_allowed_request_header(header: &HeaderName) -> bool {
    matches!(header.as_str(), "accept" | "accept-language" | "user-agent")
}

fn is_allowed_response_header(header: &HeaderName) -> bool {
    matches!(
        header.as_str(),
        "cache-control"
            | "content-encoding"
            | "content-language"
            | "content-type"
            | "etag"
            | "expires"
            | "last-modified"
    )
}

pub fn router() -> Router<crate::api::context::ApiContext> {
    Router::new().route("/", get(proxy_request_handler))
}

#[cfg(test)]
mod test;
