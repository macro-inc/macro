#![deny(missing_docs)]
//! Axum middleware for extracting client IP from requests.
//!
//! Extraction priority:
//! 1. `X-Forwarded-For` — uses the last (rightmost) IP in the chain,
//!    which is the one added by the closest trusted proxy.
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
/// Uses the last IP from the `X-Forwarded-For` header when present.
/// Falls back to the direct connection IP for environments without
/// a reverse proxy (e.g. local development).
#[derive(Debug)]
pub enum ClientIp {
    /// IP from the X-Forwarded-For header
    ForwardedFor(IpAddr),
    /// the direct ip of the client
    DirectIp(ConnectInfo<SocketAddr>),
}

impl std::fmt::Display for ClientIp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClientIp::ForwardedFor(ip_addr) => write!(f, "{ip_addr}"),
            ClientIp::DirectIp(connect_info) => {
                write!(f, "{}:{}", connect_info.ip(), connect_info.port())
            }
        }
    }
}

impl ClientIp {
    /// get the [IpAddr] of the client
    pub fn origin_ip(&self) -> IpAddr {
        match self {
            ClientIp::ForwardedFor(ip) => *ip,
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

const X_FORWARDED_FOR_HEADER: HeaderName = HeaderName::from_static("x-forwarded-for");

impl<S> FromRequestParts<S> for ClientIp
where
    S: Send + Sync,
{
    type Rejection = ClientIpError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        match parts.headers.get(X_FORWARDED_FOR_HEADER).map(parse_header) {
            Some(Ok(ip)) => Ok(ClientIp::ForwardedFor(ip)),
            Some(Err(e)) => Err(e),
            None => {
                let conn: ConnectInfo<SocketAddr> = parts.extract().await?;
                Ok(ClientIp::DirectIp(conn))
            }
        }
    }
}

fn parse_header(header: &HeaderValue) -> Result<IpAddr, ClientIpError> {
    let bytes = header.as_bytes();

    let start = bytes
        .iter()
        .enumerate()
        .rev()
        .find_map(|(idx, item)| match item {
            b',' => Some(idx + 1),
            _ => None,
        })
        .unwrap_or_default();

    let s = str::from_utf8(&bytes[start..])?.trim();

    Ok(IpAddr::from_str(s)?)
}
