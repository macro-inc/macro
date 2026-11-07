use crate::generated::types::ErrorResponse;

/// Every way an Incus call can fail.
#[derive(Debug, thiserror::Error)]
pub enum IncusError {
    /// The endpoint's certificate or key PEM could not be used.
    #[error("invalid Incus credentials: {0}")]
    InvalidCredentials(String),

    /// The instance, operation, or image does not exist (HTTP 404).
    #[error("Incus resource not found: {message}")]
    NotFound {
        /// Incus's error text, e.g. `Instance not found`.
        message: String,
    },

    /// Incus answered with an error envelope other than 404.
    #[error("Incus rejected the request ({status}): {message}")]
    Rejected {
        /// HTTP status of the response.
        status: u16,
        /// Incus's error text.
        message: String,
    },

    /// A background operation finished with `Failure`.
    #[error("Incus operation {operation_id} failed: {message}")]
    OperationFailed {
        /// The operation's UUID.
        operation_id: String,
        /// The operation's `err` text.
        message: String,
    },

    /// A background operation was cancelled before it finished.
    #[error("Incus operation {operation_id} was cancelled")]
    OperationCancelled {
        /// The operation's UUID.
        operation_id: String,
    },

    /// A background operation was still running when we stopped waiting. It
    /// keeps running on the server.
    #[error("Incus operation {operation_id} is still running")]
    OperationTimedOut {
        /// The operation's UUID.
        operation_id: String,
    },

    /// A guest command exited unsuccessfully.
    #[error("Incus guest command exited with {exit_code}")]
    ExecFailed {
        /// Command exit status.
        exit_code: i64,
    },

    /// The response decoded but lacks a field this client needs, or holds a
    /// value it does not know.
    #[error("unexpected Incus response: {0}")]
    MalformedResponse(String),

    /// The server could not be reached, refused our certificate, or sent a body
    /// that does not decode.
    #[error("Incus request failed: {0}")]
    Transport(#[source] Box<progenitor_client::Error<ErrorResponse>>),
}

impl From<progenitor_client::Error<ErrorResponse>> for IncusError {
    fn from(error: progenitor_client::Error<ErrorResponse>) -> Self {
        let progenitor_client::Error::ErrorResponse(response) = error else {
            return IncusError::Transport(Box::new(error));
        };

        let status = response.status();
        let message = response.into_inner().error.unwrap_or_default();

        if status == reqwest::StatusCode::NOT_FOUND {
            return IncusError::NotFound { message };
        }

        IncusError::Rejected {
            status: status.as_u16(),
            message,
        }
    }
}
