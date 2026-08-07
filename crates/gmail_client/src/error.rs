use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::time::Duration;

use crate::sanitize_error_body;

/// An error produced while communicating with a Gmail-related HTTP endpoint.
#[derive(Debug)]
pub enum GmailApiHttpError {
    /// The remote endpoint returned an unsuccessful HTTP status.
    Http {
        /// The HTTP status returned by the endpoint.
        status: StatusCode,
        /// The sanitized response body.
        body: String,
        /// The delay requested by the endpoint's `Retry-After` header, when present.
        retry_after: Option<Duration>,
    },
    /// The request could not be sent or the response could not be received.
    Transport(reqwest::Error),
    /// A successful HTTP response could not be decoded.
    Decode(reqwest::Error),
    /// The response was syntactically valid but omitted required data.
    InvalidResponse(String),
}

impl GmailApiHttpError {
    /// Returns the HTTP status when the endpoint returned an unsuccessful response.
    pub fn status(&self) -> Option<StatusCode> {
        match self {
            Self::Http { status, .. } => Some(*status),
            _ => None,
        }
    }

    /// Returns the sanitized response body for an unsuccessful response.
    pub fn body(&self) -> Option<&str> {
        match self {
            Self::Http { body, .. } => Some(body),
            _ => None,
        }
    }

    /// Returns the server-requested retry delay for an unsuccessful response.
    pub fn retry_after(&self) -> Option<Duration> {
        match self {
            Self::Http { retry_after, .. } => *retry_after,
            _ => None,
        }
    }
}

impl Display for GmailApiHttpError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http { status, body, .. } => {
                write!(formatter, "Gmail API returned {status}: {body}")
            }
            Self::Transport(error) => write!(formatter, "Gmail API transport error: {error}"),
            Self::Decode(error) => write!(formatter, "Gmail API response decode error: {error}"),
            Self::InvalidResponse(message) => {
                write!(
                    formatter,
                    "Gmail API returned an invalid response: {message}"
                )
            }
        }
    }
}

impl Error for GmailApiHttpError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Transport(error) | Self::Decode(error) => Some(error),
            Self::Http { .. } | Self::InvalidResponse(_) => None,
        }
    }
}

/// Converts an unsuccessful response into the crate's typed HTTP error.
///
/// Error response bodies are always read and sanitized here so provider methods
/// cannot accidentally expose response data through ad-hoc error handling.
pub(crate) async fn unsuccessful_response(response: reqwest::Response) -> GmailApiHttpError {
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_retry_after);

    let body = match response.text().await {
        Ok(body) => sanitize_error_body(&body),
        Err(error) => sanitize_error_body(&format!("Unable to read response body: {error}")),
    };

    GmailApiHttpError::Http {
        status,
        body,
        retry_after,
    }
}

/// Parses a `Retry-After` header value in either of its RFC 9110 forms:
/// delta-seconds or an HTTP-date (clamped at zero when already past).
fn parse_retry_after(value: &str) -> Option<Duration> {
    let value = value.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }

    let when = httpdate::parse_http_date(value).ok()?;
    Some(
        when.duration_since(std::time::SystemTime::now())
            .unwrap_or(Duration::ZERO),
    )
}

pub(crate) async fn decode_json_response<T>(
    response: reqwest::Response,
) -> Result<T, GmailApiHttpError>
where
    T: DeserializeOwned,
{
    response
        .json::<T>()
        .await
        .map_err(GmailApiHttpError::Decode)
}

#[cfg(test)]
mod test;
