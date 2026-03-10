use axum::Router;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures::StreamExt;
use reqwest::StatusCode;
use serde::Deserialize;
use std::error::Error;
use std::net::IpAddr;
use url::Url;
use utoipa::ToSchema;

/// 10 MB max image size
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

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
    let validated_url = validate_url(&params.url)?;
    assert_not_internal(&validated_url).await?;

    let response = send_request(&http_client, &validated_url).await?;

    let content_type = extract_content_type(&response)?;

    check_content_length(&response, &params.url)?;

    let size_limited_stream = apply_size_limit(response.bytes_stream(), params.url.clone());

    Response::builder()
        .header("Content-Type", &content_type)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(Body::from_stream(size_limited_stream))
        .map_err(|e| {
            tracing::error!(error=?e, "could not stream chunks");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })
}

fn validate_url(raw_url: &str) -> Result<Url, (StatusCode, String)> {
    let mut url =
        Url::parse(raw_url).map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid URL: {e}")))?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err((
            StatusCode::BAD_REQUEST,
            "only http/https URLs are allowed".to_string(),
        ));
    }

    url.set_fragment(None);
    Ok(url)
}

async fn assert_not_internal(url: &Url) -> Result<(), (StatusCode, String)> {
    let host = url
        .host_str()
        .ok_or((StatusCode::BAD_REQUEST, "missing host".to_string()))?;

    let port = url.port_or_known_default().unwrap_or(80);
    let addrs = tokio::net::lookup_host(format!("{host}:{port}"))
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("DNS lookup failed: {e}")))?;

    for addr in addrs {
        if is_private_ip(&addr.ip()) {
            tracing::warn!(host, ip = %addr.ip(), "blocked request to private/internal IP");
            return Err((
                StatusCode::FORBIDDEN,
                "requests to private/internal IPs are not allowed".to_string(),
            ));
        }
    }

    Ok(())
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
        }
        IpAddr::V6(v6) => {
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                return is_private_ip(&IpAddr::V4(mapped_v4));
            }
            v6.is_loopback() || v6.is_unspecified()
        }
    }
}

async fn send_request(
    http_client: &reqwest::Client,
    url: &Url,
) -> Result<reqwest::Response, (StatusCode, String)> {
    let response = http_client.get(url.as_str()).send().await.map_err(|e| {
        let error_chain = build_error_chain(&e);
        if e.is_timeout() {
            (
                StatusCode::GATEWAY_TIMEOUT,
                format!("timeout fetching upstream image: {error_chain}"),
            )
        } else if e.is_connect() {
            (
                StatusCode::BAD_GATEWAY,
                format!("connection error fetching upstream image: {error_chain}"),
            )
        } else if e.is_redirect() {
            (
                StatusCode::BAD_GATEWAY,
                format!("too many redirects fetching upstream image: {error_chain}"),
            )
        } else {
            (
                StatusCode::BAD_GATEWAY,
                format!("network error fetching upstream image: {error_chain}"),
            )
        }
    })?;

    if !response.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("upstream returned status {}", response.status()),
        ));
    }

    Ok(response)
}

fn extract_content_type(response: &reqwest::Response) -> Result<String, (StatusCode, String)> {
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    if !content_type.starts_with("image/") {
        return Err((
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            format!("upstream content-type is not an image: {content_type}"),
        ));
    }

    Ok(content_type)
}

fn check_content_length(
    response: &reqwest::Response,
    original_url: &str,
) -> Result<(), (StatusCode, String)> {
    if let Some(content_length) = response.content_length() {
        tracing::info!(
            content_length,
            url = original_url,
            "upstream content length"
        );
        if content_length > MAX_IMAGE_SIZE {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                format!(
                    "image exceeds max size of {MAX_IMAGE_SIZE} bytes (Content-Length: {content_length})"
                ),
            ));
        }
    }
    Ok(())
}

fn apply_size_limit<S: futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send>(
    stream: S,
    url: String,
) -> impl futures::Stream<Item = Result<bytes::Bytes, axum::Error>> + Send + use<S> {
    let mut bytes_received: u64 = 0;

    stream.map(move |chunk_result: Result<bytes::Bytes, reqwest::Error>| {
        let chunk = chunk_result.map_err(axum::Error::new)?;
        bytes_received += chunk.len() as u64;
        if bytes_received > MAX_IMAGE_SIZE {
            tracing::warn!(
                bytes_received,
                max = MAX_IMAGE_SIZE,
                url = url,
                "image exceeded max size during streaming"
            );
            return Err(axum::Error::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("image exceeded max size of {MAX_IMAGE_SIZE} bytes during streaming"),
            )));
        }
        Ok(chunk)
    })
}

fn build_error_chain(err: &reqwest::Error) -> String {
    let mut chain = format!("{err}");
    let mut source = err.source();
    while let Some(cause) = source {
        chain.push_str(&format!("\nCaused by: {cause}"));
        source = cause.source();
    }
    chain
}

pub fn router() -> Router<crate::api::context::ApiContext> {
    Router::new().route("/", get(proxy_request_handler))
}

#[cfg(test)]
mod test;
