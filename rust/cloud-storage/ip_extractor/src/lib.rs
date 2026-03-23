#![deny(missing_docs)]
//! Axum middleware for extracting client IP from requests.
//!
//! Extraction priority:
//! 1. `CloudFront-Viewer-Address` — set by CloudFront to the real client IP
//!    (cannot be spoofed by clients). Format: `ip:port`.
//! 2. `ConnectInfo<SocketAddr>` — direct TCP peer address.

#[cfg(test)]
mod test;

use axum::{
    RequestPartsExt,
    extract::{ConnectInfo, FromRequestParts, rejection::ExtensionRejection},
    http::{HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use std::{
    net::{AddrParseError, IpAddr, SocketAddr},
    str::{FromStr, Utf8Error},
};
use thiserror::Error;

/// The best guess at what the originating IP of a client request is.
///
/// Behind CloudFront, uses the `CloudFront-Viewer-Address` header which
/// cannot be spoofed by clients. Falls back to the direct connection IP
/// for non-CloudFront environments (e.g. local development).
#[derive(Debug)]
pub enum ClientIp {
    /// IP from the CloudFront-Viewer-Address header
    CloudFrontViewer(IpAddr),
    /// the direct ip of the client
    DirectIp(ConnectInfo<SocketAddr>),
}

impl ClientIp {
    /// get the [IpAddr] of the client
    pub fn origin_ip(&self) -> IpAddr {
        match self {
            ClientIp::CloudFrontViewer(ip) => *ip,
            ClientIp::DirectIp(connect_info) => connect_info.ip(),
        }
    }
}

/// The errors that can occur while extracting a [ClientIp]
#[derive(Debug, Error)]
pub enum ClientIpError {
    /// the header contained an invalid ip address (v4/v6) value
    #[error("invalid ip address {0:?}")]
    ParseErr(#[from] AddrParseError),
    /// the header contained non-ascii chars
    #[error("invalid ascii {0:?}")]
    InvalidAscii(#[from] Utf8Error),
    /// the axum server did not call into_make_service_with_conn_info
    #[error("Internal server err")]
    ExtensionErr(#[from] ExtensionRejection),
}

impl IntoResponse for ClientIpError {
    fn into_response(self) -> Response {
        let code = match &self {
            ClientIpError::ParseErr(_addr_parse_error) => StatusCode::BAD_REQUEST,
            ClientIpError::InvalidAscii(_utf8_error) => StatusCode::BAD_REQUEST,
            ClientIpError::ExtensionErr(_extension_rejection) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (code, self.to_string()).into_response()
    }
}

const CLOUDFRONT_VIEWER_ADDRESS: HeaderName = HeaderName::from_static("cloudfront-viewer-address");

impl<S> FromRequestParts<S> for ClientIp
where
    S: Send + Sync,
{
    type Rejection = ClientIpError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        // 1. Prefer CloudFront-Viewer-Address (unspoofable, set by CloudFront)
        if let Some(header) = parts.headers.get(CLOUDFRONT_VIEWER_ADDRESS) {
            let ip = parse_viewer_address(header)?;
            return Ok(ClientIp::CloudFrontViewer(ip));
        }

        // 2. Direct connection
        let conn: ConnectInfo<SocketAddr> = parts.extract().await?;
        Ok(ClientIp::DirectIp(conn))
    }
}

/// Parse the `CloudFront-Viewer-Address` header, which has the format `ip:port`.
fn parse_viewer_address(header: &HeaderValue) -> Result<IpAddr, ClientIpError> {
    let s = str::from_utf8(header.as_bytes())?.trim();

    // The header format is `ip:port` for IPv4 or `[ip]:port` for IPv6.
    if let Some(bracketed) = s.strip_prefix('[') {
        // IPv6: [2001:db8::1]:12345
        let ip_str = bracketed.split(']').next().unwrap_or(s);
        Ok(IpAddr::from_str(ip_str)?)
    } else {
        // IPv4: 203.0.113.50:12345 — split on the last colon to separate port
        let ip_str = s.rsplit_once(':').map_or(s, |(ip, _port)| ip);
        Ok(IpAddr::from_str(ip_str)?)
    }
}
