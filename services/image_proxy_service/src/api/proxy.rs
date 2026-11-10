use crate::api::context::AuthorizationService;

use axum::Router;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_middleware::tracking::ClientIp;
use model::response::ErrorResponse;
use reqwest::StatusCode;
use serde::Deserialize;
use tracing::Level;
use utoipa::ToSchema;

pub(crate) use crate::outbound::remote_image::*;

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Busy => StatusCode::SERVICE_UNAVAILABLE,
            Self::InvalidUrl(_)
            | Self::InvalidScheme
            | Self::MissingHost
            | Self::DnsLookupFailed(_) => StatusCode::BAD_REQUEST,
            Self::PrivateIp => StatusCode::FORBIDDEN,
            Self::UpstreamTimeout(_) => StatusCode::GATEWAY_TIMEOUT,
            // Hosts refuse hotlinking or have dropped the image; neither is
            // a gateway failure.
            Self::UpstreamStatus(status) if status.is_client_error() => StatusCode::NOT_FOUND,
            Self::UpstreamConnect(_)
            | Self::UpstreamRedirect(_)
            | Self::UpstreamNetwork(_)
            | Self::UpstreamStatus(_) => StatusCode::BAD_GATEWAY,
            Self::NotAnImage(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::ImageTooLarge { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            Self::ResponseBuild(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

#[derive(Debug, ToSchema, Deserialize)]
pub struct ProxyParams {
    pub url: String,
}

#[utoipa::path(
    get,
    path = "/proxy",
    params(("url" = String, Query, description = "The image url to proxy")),
    responses(
        (status = 401, description = "Unauthorized", body = ErrorResponse),
    ),
)]
// WARN: every refusal here is the URL's or its host's doing. A response that
// fails to build is ours, and logs at ERROR where it happens.
#[tracing::instrument(
    err(level = Level::WARN, Debug),
    skip(user, http_client),
    fields(actor = %user.acting_entity())
)]
pub async fn proxy_request_handler(
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Query(params): Query<ProxyParams>,
    State(http_client): State<reqwest::Client>,
    _ip: ClientIp,
) -> Result<Response, ProxyError> {
    let url = validate_url(&params.url)?;

    // Primary attempt with a browser-like User-Agent — most hosts are fine
    // either way, but strict origins 403 a missing UA.
    let (response, content_type) = match fetch_upstream(&http_client, url.clone(), true).await {
        Ok(ok) => ok,
        // A minority of hosts reject our browser UA or serve a non-image
        // challenge page. Retry once with no UA to cover them.
        Err(err) if err.is_retryable_without_ua() => {
            tracing::info!(url = %params.url, error = %err, "retrying upstream fetch without User-Agent");
            fetch_upstream(&http_client, url, false).await?
        }
        Err(err) => return Err(err),
    };

    check_content_length(&response, &params.url)?;

    let size_limited_stream = apply_size_limit(response.bytes_stream(), params.url.clone());

    Response::builder()
        .header("Content-Type", &content_type)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(Body::from_stream(size_limited_stream))
        .map_err(|e| {
            tracing::error!(error=?e, "could not stream chunks");
            ProxyError::ResponseBuild(e)
        })
}

pub fn router() -> Router<crate::api::context::ApiContext> {
    Router::new().route("/", get(proxy_request_handler))
}

#[cfg(test)]
mod test;
