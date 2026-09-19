use std::time::Duration;

/// Failures returned by the Namespace provider.
#[derive(Debug, thiserror::Error)]
#[allow(missing_docs)]
pub enum NamespaceError {
    /// The requested instance lifetime cannot be represented by chrono.
    #[error("instance lifetime is out of range")]
    LifetimeOutOfRange(#[source] chrono::OutOfRangeError),
    /// Namespace omitted the endpoint needed to execute commands.
    #[error("instance {instance_id} came back without a command service endpoint")]
    MissingCommandServiceEndpoint { instance_id: String },
    /// Namespace did not report the instance ready before the deadline.
    #[error("instance {instance_id} was not ready within {timeout:?}")]
    InstanceReadyTimeout {
        instance_id: String,
        timeout: Duration,
    },
    /// Namespace did not allocate an ingress for the requested port.
    #[error("no ingress was allocated for port {port}")]
    NoIngressAllocated { port: u16 },
    /// A Connect request could not be sent.
    #[error("{method} request failed")]
    Request {
        method: &'static str,
        #[source]
        source: reqwest::Error,
    },
    /// A Connect response body could not be read.
    #[error("failed to read the {method} response")]
    ReadResponse {
        method: &'static str,
        #[source]
        source: reqwest::Error,
    },
    /// Namespace returned an unsuccessful Connect response.
    #[error("{method} failed: namespace returned {status}: {body}")]
    Api {
        method: &'static str,
        status: reqwest::StatusCode,
        body: String,
    },
    /// A successful response did not match Namespace's response schema.
    #[error("failed to parse the {method} response: {source}: {body}")]
    Decode {
        method: &'static str,
        #[source]
        source: serde_json::Error,
        body: String,
    },
    /// Connect's base64 encoding for a command stream was invalid.
    #[error("{stream} was not valid base64")]
    InvalidBase64 {
        stream: &'static str,
        #[source]
        source: base64::DecodeError,
    },
    /// The readiness command failed inside the instance.
    #[error("readiness recipe exited {exit_code} in instance {instance_id}:\n{stdout}\n{stderr}")]
    ReadinessRecipe {
        instance_id: String,
        exit_code: i32,
        stdout: String,
        stderr: String,
    },
    /// Namespace returned an ingress URL that could not be parsed.
    #[error("invalid sidecar ingress URL {url}")]
    InvalidIngressUrl {
        url: String,
        #[source]
        source: url::ParseError,
    },
    /// Namespace returned an ingress URL with an unsupported scheme.
    #[error("unsupported sidecar ingress URL scheme {scheme}")]
    UnsupportedIngressScheme { scheme: String },
    /// The sidecar WebSocket could not be reached through the ingress.
    #[error("dialing the sidecar WebSocket through the ingress failed")]
    WebSocketConnect(#[source] tokio_tungstenite::tungstenite::Error),
}

/// Result returned by the Namespace provider.
pub type Result<T> = std::result::Result<T, NamespaceError>;
