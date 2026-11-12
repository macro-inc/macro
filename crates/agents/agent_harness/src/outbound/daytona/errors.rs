use std::time::Duration;

/// Failures returned by the Daytona HTTP client.
#[derive(Debug, thiserror::Error)]
#[allow(missing_docs)]
pub enum DaytonaError {
    /// A label filter could not be serialized for Daytona's query format.
    #[error("could not encode the label filter")]
    EncodeLabelFilter(#[source] serde_json::Error),
    /// An HTTP request could not be sent.
    #[error("failed to {operation}")]
    Request {
        operation: &'static str,
        #[source]
        source: reqwest::Error,
    },
    /// An HTTP response body could not be read.
    #[error("failed to read the {operation} response")]
    ReadResponse {
        operation: &'static str,
        #[source]
        source: reqwest::Error,
    },
    /// Daytona returned an unsuccessful HTTP response.
    #[error("failed to {operation}: daytona returned {status}: {body}")]
    Api {
        operation: &'static str,
        status: reqwest::StatusCode,
        body: String,
    },
    /// `POST /sandbox/{id}/resize` is not registered for a real sandbox on this API.
    ///
    /// Daytona documents resize as generally available. A missing sandbox 404s
    /// with "not found" (the route exists). A real sandbox 404s with NestJS
    /// `Cannot POST .../resize` — the official Python SDK hits the same error.
    #[error(
        "daytona POST /sandbox/{{id}}/resize is not available for this organization (404 Cannot POST); documented as generally available"
    )]
    ResizeNotEnabled,
    /// A successful response did not match Daytona's response schema.
    #[error("failed to parse the {operation} response: {source}: {body}")]
    Decode {
        operation: &'static str,
        #[source]
        source: serde_json::Error,
        body: String,
    },
    /// A sandbox reached a terminal state while starting.
    #[error("sandbox {sandbox_id} failed to start ({state}): {reason}")]
    SandboxStart {
        sandbox_id: String,
        state: String,
        reason: String,
    },
    /// A sandbox did not start before its deadline.
    #[error("sandbox {sandbox_id} was not started within {timeout:?}")]
    SandboxStartTimeout {
        sandbox_id: String,
        timeout: Duration,
    },
    /// A sandbox command returned a non-zero exit code.
    #[error("command exited {code} in sandbox {sandbox_id}: {command}\n{output}")]
    Command {
        code: i32,
        sandbox_id: String,
        command: String,
        output: String,
    },
    /// The sidecar readiness probe did not succeed before its deadline.
    #[error("sidecar did not answer {ping_url} within {timeout:?}")]
    PingTimeout { ping_url: String, timeout: Duration },
    /// Daytona returned a preview URL that could not be parsed.
    #[error("invalid sidecar preview URL {url}")]
    InvalidPreviewUrl {
        url: String,
        #[source]
        source: url::ParseError,
    },
    /// Daytona returned a preview URL with a scheme WebSocket cannot map.
    #[error("unsupported sidecar preview URL scheme {scheme}")]
    UnsupportedPreviewScheme { scheme: String },
    /// A parsed preview URL could not become a WebSocket request.
    #[error("the sidecar preview URL is not a valid WebSocket request")]
    WebSocketRequest(#[source] tokio_tungstenite::tungstenite::Error),
    /// Daytona's preview token was not valid as an HTTP header value.
    #[error("the preview token is not header-safe")]
    InvalidPreviewToken(#[source] tokio_tungstenite::tungstenite::http::header::InvalidHeaderValue),
    /// The sidecar WebSocket connection could not be established.
    #[error("dialing the sidecar WebSocket failed")]
    WebSocketConnect(#[source] tokio_tungstenite::tungstenite::Error),
}

/// Result returned by the Daytona client.
pub type Result<T> = std::result::Result<T, DaytonaError>;
