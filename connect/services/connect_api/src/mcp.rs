use std::time::Instant;

use axum::{
    Json,
    body::Body,
    extract::{Extension, Path, Request, State},
    http::{HeaderMap, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use bytes::Bytes;
use connect_client::wire::McpErrorResponse;
use futures::StreamExt as _;
use uuid::Uuid;

use crate::{AppState, domain::Error};

const RETRY_BODY_LIMIT: usize = 1024 * 1024;

fn error(status: StatusCode, code: &'static str, app_id: &str) -> Response {
    (
        status,
        Json(McpErrorResponse {
            error: code.to_owned(),
            app_id: app_id.to_owned(),
        }),
    )
        .into_response()
}

fn domain_error(error_value: Error, app_id: &str) -> Response {
    match error_value {
        Error::NotFound => error(StatusCode::NOT_FOUND, "not_found", app_id),
        Error::NeedsReauth => error(StatusCode::CONFLICT, "needs_reauth", app_id),
        _ => error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", app_id),
    }
}

fn forward_headers(source: &HeaderMap, destination: &mut HeaderMap) {
    for name in [
        header::ACCEPT,
        header::CONTENT_TYPE,
        header::HeaderName::from_static("mcp-session-id"),
        header::HeaderName::from_static("mcp-protocol-version"),
    ] {
        if let Some(value) = source.get(&name) {
            destination.insert(name, value.clone());
        }
    }
}

async fn request_body(body: Body) -> Result<(reqwest::Body, Option<Bytes>), axum::Error> {
    let mut stream = body.into_data_stream();
    let mut prefix = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if prefix.len() + chunk.len() > RETRY_BODY_LIMIT {
            let body = async_stream::stream! {
                yield Ok::<Bytes, axum::Error>(Bytes::from(prefix));
                yield Ok(chunk);
                while let Some(next) = stream.next().await {
                    yield next;
                }
            };
            return Ok((reqwest::Body::wrap_stream(body), None));
        }
        prefix.extend_from_slice(&chunk);
    }
    let bytes = Bytes::from(prefix);
    Ok((reqwest::Body::from(bytes.clone()), Some(bytes)))
}

#[utoipa::path(
    method(post, get, delete),
    path = "/v1/users/{external_user_id}/mcp/{app_id}",
    params(("external_user_id" = String, Path), ("app_id" = String, Path)),
    responses(
        (status = 200, description = "Vendor MCP response; JSON or SSE"),
        (status = 401, description = "Invalid customer key"),
        (status = 404, body = McpErrorResponse),
        (status = 409, body = McpErrorResponse, description = "Connection needs reauthorization")
    ),
    security(("customer_key" = []))
)]
#[tracing::instrument(
    name = "connect.mcp.proxy",
    skip_all,
    fields(customer_id = %customer_id, app_id = %app_id, method, vendor_status, refresh_retry, bytes, time_to_first_byte_ms)
)]
pub async fn proxy(
    State(state): State<AppState>,
    Extension(customer_id): Extension<Uuid>,
    Path((user_id, app_id)): Path<(String, String)>,
    request: Request,
) -> Response {
    let mcp_url = match state.oauth.mcp_url(&app_id) {
        Ok(url) => url,
        Err(error_value) => return domain_error(error_value, &app_id),
    };
    let span = tracing::Span::current();
    let (parts, body) = request.into_parts();
    let (outbound_body, replay) = match request_body(body).await {
        Ok(body) => body,
        Err(_) => return error(StatusCode::BAD_REQUEST, "invalid_body", &app_id),
    };
    if parts.method == Method::POST
        && let Some(bytes) = &replay
        && let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes)
        && let Some(method) = value.get("method").and_then(serde_json::Value::as_str)
    {
        span.record("method", method);
    }
    let grant = match state.oauth.export(customer_id, &user_id, &app_id).await {
        Ok(grant) => grant,
        Err(error_value) => return domain_error(error_value, &app_id),
    };
    let mut token = grant;
    let mut retried = false;
    let mut outbound_body = Some(outbound_body);
    loop {
        let mut headers = HeaderMap::new();
        forward_headers(&parts.headers, &mut headers);
        let Some(body) = outbound_body.take() else {
            return error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &app_id);
        };
        let started = Instant::now();
        let response = state
            .mcp_http
            .send(
                parts.method.clone(),
                mcp_url,
                headers,
                &token.access_token,
                body,
            )
            .await;
        let response = match response {
            Ok(response) => response,
            Err(_) => {
                span.record("refresh_retry", "vendor_error");
                return error(StatusCode::BAD_GATEWAY, "vendor_error", &app_id);
            }
        };
        span.record("vendor_status", response.status().as_u16());
        if response.status() == StatusCode::UNAUTHORIZED {
            match state
                .oauth
                .recover_vendor_unauthorized(
                    customer_id,
                    &user_id,
                    &app_id,
                    &token.access_token,
                    replay.is_some(),
                    retried,
                )
                .await
            {
                Ok(Some(grant)) => {
                    retried = true;
                    token = grant;
                    if let Some(bytes) = &replay {
                        outbound_body = Some(reqwest::Body::from(bytes.clone()));
                    }
                    continue;
                }
                Ok(None) => {}
                Err(error_value) => {
                    span.record(
                        "refresh_retry",
                        if retried {
                            "second_401"
                        } else {
                            "refresh_failed"
                        },
                    );
                    return domain_error(error_value, &app_id);
                }
            }
        }
        span.record(
            "refresh_retry",
            if retried {
                "success"
            } else if response.status() == StatusCode::UNAUTHORIZED {
                "body_too_large"
            } else {
                "none"
            },
        );
        return stream_response(response, span, started, &app_id);
    }
}

fn stream_response(
    response: reqwest::Response,
    span: tracing::Span,
    started: Instant,
    app_id: &str,
) -> Response {
    let mut builder = Response::builder().status(response.status());
    for name in [
        header::CONTENT_TYPE,
        header::HeaderName::from_static("mcp-session-id"),
    ] {
        if let Some(value) = response.headers().get(&name) {
            builder = builder.header(name, value);
        }
    }
    let mut source = response.bytes_stream();
    let response_body = async_stream::stream! {
        let mut total = 0_u64;
        let mut first = true;
        while let Some(next) = source.next().await {
            match next {
                Ok(bytes) => {
                    if first {
                        span.record("time_to_first_byte_ms", started.elapsed().as_millis() as u64);
                        first = false;
                    }
                    total += bytes.len() as u64;
                    span.record("bytes", total);
                    yield Ok::<Bytes, reqwest::Error>(bytes);
                }
                Err(error_value) => {
                    tracing::warn!(parent: &span, error = ?error_value, "MCP response stream failed");
                    yield Err(error_value);
                    break;
                }
            }
        }
        if first {
            span.record("time_to_first_byte_ms", started.elapsed().as_millis() as u64);
            span.record("bytes", 0_u64);
        }
    };
    builder
        .body(Body::from_stream(response_body))
        .unwrap_or_else(|_| error(StatusCode::BAD_GATEWAY, "vendor_error", app_id))
}

#[cfg(test)]
mod test;
