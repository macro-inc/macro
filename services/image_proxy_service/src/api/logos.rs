//! Authenticated logo transport.

use axum::{
    Router,
    extract::{Query, State},
    response::{IntoResponse, Response},
    routing::get,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use reqwest::StatusCode;
use serde::Deserialize;

use super::context::{ApiContext, AuthorizationService};
use crate::{
    domain::{LogoDomain, LogoError, LogoService},
    outbound::{FaviconProvider, remote_image::ProxyError},
};

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
        };
        (status, self.to_string()).into_response()
    }
}

#[derive(Deserialize)]
pub struct LogoParams {
    domain: String,
}

#[utoipa::path(get, path = "/logos", params(("domain" = String, Query, description = "Public DNS domain")), responses((status = 200, description = "Cached raster favicon"), (status = 401, description = "Unauthorized")))]
#[tracing::instrument(skip_all, err)]
pub(crate) async fn logo_handler(
    _user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    State(service): State<LogoService<FaviconProvider>>,
    Query(params): Query<LogoParams>,
) -> Result<Response, ProxyError> {
    let domain = LogoDomain::parse(&params.domain)
        .ok_or_else(|| ProxyError::InvalidUrl("expected public DNS domain".into()))?;
    let logo = service.get(domain).await.map_err(|error| match error {
        LogoError::Busy => ProxyError::Busy,
        LogoError::Provider(error) => error,
    })?;
    Ok((
        [
            ("content-type", logo.content_type.as_str()),
            ("cache-control", "private, max-age=86400"),
            ("x-content-type-options", "nosniff"),
        ],
        logo.bytes,
    )
        .into_response())
}

pub(super) fn router() -> Router<ApiContext> {
    Router::new().route("/logos", get(logo_handler))
}
