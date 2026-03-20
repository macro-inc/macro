#![deny(missing_docs)]
//! Axum middleware for extracting client IP from requests.

#[cfg(test)]
mod test;

use std::{
    net::{AddrParseError, IpAddr, SocketAddr},
    str::{FromStr, Utf8Error},
};

use anyhow::Context;
use axum::{
    Json, RequestPartsExt,
    extract::{ConnectInfo, FromRequestParts, Request, rejection::ExtensionRejection},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_env::Environment;
use model::{response::ErrorResponse, tracking::IPContext};
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

/// Extracts the client IP from the `x-forwarded-for` header and attaches it as
/// an [`IPContext`] extension on the request.
///
/// In local development (determined by [`Environment`]), falls back to the
/// `LOCAL_IP` env var or `127.0.0.1`.
pub async fn attach_ip_context_handler(mut req: Request, next: Next) -> Result<Response, Response> {
    // If running locally we automatically attach the ip context for you
    if let Environment::Local = Environment::new_or_prod() {
        req.extensions_mut().insert(IPContext {
            client_ip: std::env::var("LOCAL_IP").unwrap_or("127.0.0.1".to_string()),
        });
        return Ok(next.run(req).await);
    }

    let headers = req.headers();
    let client_ip = get_ip_from_x_forwarded_for(headers)
        .context("no ip provided")
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "no ip provided",
                }),
            )
                .into_response()
        })?;

    // Attach user to the UserContext and to the request
    req.extensions_mut().insert(IPContext { client_ip });

    Ok(next.run(req).await)
}

fn get_ip_from_x_forwarded_for(headers: &HeaderMap) -> Option<String> {
    let x_forwarded_for = headers
        .get("x-forwarded-for")
        .and_then(|header| header.to_str().ok());

    if let Some(x_forwarded_for) = x_forwarded_for {
        let ip = x_forwarded_for
            .split(',')
            .next()
            .map(|ip| ip.trim().to_string());
        return ip;
    }

    None
}
