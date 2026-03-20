#![deny(missing_docs)]
//! Axum middleware for extracting client IP from requests.

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

/// The best guess at what the originating IP of a client request is
/// uses the x-forwarded-for header if it exists, falling back to the client ip
#[derive(Debug)]
pub enum ClientIp {
    /// the leftmost x-forwarded-for value of the request
    ForwardedFor(IpAddr),
    /// the direct ip of the client
    DirectIp(ConnectInfo<SocketAddr>),
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

/// The errors that can occur while extracing a [ClientIp]
#[derive(Debug, Error)]
pub enum ClientIpError {
    /// the x-forwarded-for contained invalid ip address (v4/v6) values
    #[error("invalid ip address {0:?}")]
    ParseErr(#[from] AddrParseError),
    /// the header contained non-ascii chars
    #[error("invalid asci {0:?}")]
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

    let comma_index = bytes
        .iter()
        .enumerate()
        .find_map(|(idx, item)| match item {
            b',' => Some(idx),
            _ => None,
        })
        .unwrap_or(bytes.len());

    let s = str::from_utf8(&bytes[..comma_index])?.trim();

    Ok(IpAddr::from_str(s)?)
}
