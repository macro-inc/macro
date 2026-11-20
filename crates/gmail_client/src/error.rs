use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde_json::error::Category;
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
    /// A successful HTTP response could not be decoded. Names the JSON path
    /// and the kind of problem, never the response's values.
    Decode(String),
    /// The response was syntactically valid but omitted required data.
    InvalidResponse(String),
}

impl GmailApiHttpError {
    /// Wraps a send failure, stripping the request URL so query parameters
    /// (e.g. People-API `syncToken`s) cannot leak into logs via `Display`.
    pub(crate) fn transport(error: reqwest::Error) -> Self {
        Self::Transport(error.without_url())
    }

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
            Self::Decode(problem) => {
                write!(formatter, "Gmail API response decode error: {problem}")
            }
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
            Self::Transport(error) => Some(error),
            Self::Http { .. } | Self::Decode(_) | Self::InvalidResponse(_) => None,
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

    let body = sanitize_error_body(&read_error_body_capped(response).await);

    GmailApiHttpError::Http {
        status,
        body,
        retry_after,
    }
}

/// The most we will *read* of an error body (not just retain after
/// truncation): a hostile or misbehaving endpoint must not make us buffer an
/// arbitrarily large response just to report a failure.
const MAX_ERROR_BODY_READ_BYTES: usize = 8 * 1024;

async fn read_error_body_capped(mut response: reqwest::Response) -> String {
    let mut collected: Vec<u8> = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = MAX_ERROR_BODY_READ_BYTES - collected.len();
                collected.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if collected.len() >= MAX_ERROR_BODY_READ_BYTES {
                    break;
                }
            }
            Ok(None) => break,
            Err(error) => return format!("Unable to read response body: {error}"),
        }
    }

    String::from_utf8_lossy(&collected).into_owned()
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

/// Decodes a successful JSON response. A failure names the JSON path it
/// happened at and, for a missing or duplicate field, the field; serde's own
/// message is dropped because it quotes the offending value, which can be an
/// address or mail content. The path is built from the response's own keys,
/// so a wire type that is a map keyed by such data needs its own decoder.
pub(crate) async fn decode_json_response<T>(
    response: reqwest::Response,
) -> Result<T, GmailApiHttpError>
where
    T: DeserializeOwned,
{
    let body = response
        .bytes()
        .await
        .map_err(GmailApiHttpError::transport)?;
    decode_json(&body)
}

fn decode_json<T: DeserializeOwned>(body: &[u8]) -> Result<T, GmailApiHttpError> {
    let mut deserializer = serde_json::Deserializer::from_slice(body);
    let value = serde_path_to_error::deserialize(&mut deserializer).map_err(|error| {
        let problem = match error.inner().classify() {
            Category::Data => data_problem(&error.inner().to_string()),
            Category::Eof => "truncated JSON".to_owned(),
            Category::Syntax | Category::Io => "malformed JSON".to_owned(),
        };
        GmailApiHttpError::Decode(format!("{problem} at {}", error.path()))
    })?;

    deserializer
        .end()
        .map_err(|_| GmailApiHttpError::Decode("trailing data after JSON".to_owned()))?;
    Ok(value)
}

/// Field names come from the wire types, so they are safe to report; any
/// other data error is summarized.
fn data_problem(message: &str) -> String {
    for kind in ["missing field `", "duplicate field `"] {
        if let Some((field, _)) = message
            .strip_prefix(kind)
            .and_then(|rest| rest.split_once('`'))
        {
            return format!("{kind}{field}`");
        }
    }

    "unexpected value".to_owned()
}

#[cfg(test)]
mod test;
