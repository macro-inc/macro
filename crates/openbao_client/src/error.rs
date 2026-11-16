use crate::{SecretString, generated::types::ErrorResponse};

/// Stable safe failure categories; provider messages are never formatting fields.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cause {
    /// A JWT/token is invalid or its policy denied the operation.
    Authentication,
    /// The namespace does not exist or cannot be selected.
    Namespace,
    /// The exact KV check-and-set version did not match.
    CasMismatch,
    /// The requested resource/version is missing.
    NotFound,
    /// The server rejected a request for another reason.
    Rejected,
    /// Rate limit or server-side failure.
    Unavailable,
    /// Request timed out; a mutation may have been accepted.
    Timeout,
    /// Connection failed; acceptance is unknown.
    Transport,
    /// The response could not be decoded as the declared wire contract.
    InvalidResponse,
    /// A local endpoint, header or input is invalid.
    InvalidInput,
}

/// A redacted provider failure, preserving its status and original error envelope.
///
/// Ordinary Debug, Display and source chains never reveal provider messages.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A server rejected the request; its original messages remain sensitive.
    #[error("OpenBao request failed ({cause:?}, status {status})")]
    Response {
        /// Fixed safe category for caller mapping.
        cause: Cause,
        /// HTTP response status.
        status: u16,
        /// Sensitive original error messages, redacted by ordinary formatting.
        messages: Vec<SecretString>,
    },
    /// The request could not be sent or its response could not be decoded.
    #[error("OpenBao client failed ({cause:?})")]
    Client {
        /// Fixed safe category; raw transport errors are never retained.
        cause: Cause,
    },
}

#[derive(Clone, Copy)]
pub(crate) enum Operation<'a> {
    Other,
    Login,
    Cas,
    Namespace,
    TotpCode(&'a str),
}

impl Error {
    pub(crate) fn local(cause: Cause) -> Self {
        Self::Client { cause }
    }

    /// Deliberate access to the original sensitive server messages.
    /// Never include these values in logs, tracing or public responses.
    pub fn provider_messages(&self) -> &[SecretString] {
        match self {
            Self::Response { messages, .. } => messages,
            Self::Client { .. } => &[],
        }
    }

    /// Safe category for policy-free caller mapping.
    pub fn cause(&self) -> Cause {
        match self {
            Self::Response { cause, .. } | Self::Client { cause } => *cause,
        }
    }

    /// HTTP status when retained by the generated response error.
    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Response { status, .. } => Some(*status),
            Self::Client { .. } => None,
        }
    }

    pub(crate) fn generated(
        error: progenitor_client::Error<ErrorResponse>,
        operation: Operation<'_>,
    ) -> Self {
        use progenitor_client::Error as WireError;
        match error {
            WireError::ErrorResponse(response) => {
                let status = response.status().as_u16();
                let messages = response.into_inner().errors;
                let missing_totp = if let Operation::TotpCode(name) = operation {
                    let expected = format!("unknown key: {name}");
                    status == 400 && messages.iter().any(|message| message.expose() == expected)
                } else {
                    false
                };
                let cause = if status == 400
                    && matches!(operation, Operation::Cas)
                    && messages.iter().any(|message| {
                        message.expose()
                            == "check-and-set parameter did not match the current version"
                    }) {
                    Cause::CasMismatch
                } else if missing_totp {
                    Cause::NotFound
                } else if status == 404
                    && (matches!(operation, Operation::Namespace)
                        || messages
                            .iter()
                            .any(|message| message.expose() == "namespace not found"))
                {
                    Cause::Namespace
                } else if matches!(status, 401 | 403)
                    || (status == 400 && matches!(operation, Operation::Login))
                {
                    Cause::Authentication
                } else if status == 404 {
                    Cause::NotFound
                } else if status == 429 || status >= 500 {
                    Cause::Unavailable
                } else {
                    Cause::Rejected
                };
                Self::Response {
                    cause,
                    status,
                    messages,
                }
            }
            WireError::CommunicationError(error) | WireError::ResponseBodyError(error) => {
                Self::local(if error.is_timeout() {
                    Cause::Timeout
                } else {
                    Cause::Transport
                })
            }
            WireError::InvalidRequest(_) => Self::local(Cause::InvalidInput),
            WireError::UnexpectedResponse(response) => Self::Response {
                cause: Cause::Rejected,
                status: response.status().as_u16(),
                messages: Vec::new(),
            },
            // These errors can carry plaintext response bytes or request URLs.
            // Do not preserve them in std::error::Error::source or formatting.
            _ => Self::local(Cause::InvalidResponse),
        }
    }
}
