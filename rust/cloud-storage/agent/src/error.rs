use rig_core::agent::StreamingError;
use rig_core::completion::{CompletionError, PromptError};

#[cfg(test)]
mod test;

/// How a failed agent turn should be surfaced to the user.
///
/// Lets callers (e.g. the chat stream endpoint) turn an opaque [`AgentError`]
/// into a well-typed, user-facing error without re-implementing the rig error
/// archaeology below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    /// The model provider returned an error or was unreachable — most likely a
    /// provider outage. The user should try a different model / provider.
    ProviderOutage,
    /// The request exceeded the model's context window.
    ContextOverflow,
    /// Anything else (serialization, our own bug, etc.).
    Internal,
}

/// Errors produced by the agent crate.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    /// An error from the RIG completion layer.
    #[error(transparent)]
    Completion(#[from] rig_core::completion::CompletionError),
    /// An error from the RIG prompt/agentic loop.
    #[error(transparent)]
    Prompt(#[from] rig_core::completion::PromptError),
    /// An error from the RIG streaming layer.
    #[error(transparent)]
    Streaming(#[from] rig_core::agent::StreamingError),
    /// Serialization / deserialization failure.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Catch-all.
    #[error(transparent)]
    Other(#[from] anyhow::Error),
    /// Unknown completion model
    #[error("unknown completion model [{0}]")]
    UnknownModel(String),
    /// Model id missing a `provider/` segment.
    #[error("malformed model")]
    MalformedModel(String),
    /// Expected env var
    #[error(transparent)]
    EnvVar(#[from] macro_env_var::VarNameErr),
    /// Provider client error
    #[error(transparent)]
    ProviderClientError(#[from] rig_core::client::ProviderClientError),
    /// Rig http client error
    #[error(transparent)]
    RigHttpClient(#[from] rig_core::http_client::Error),
}

impl AgentError {
    /// is the error caused by a cancellation
    pub fn was_cancelled(&self) -> bool {
        use rig_core::agent::StreamingError;
        use rig_core::completion::PromptError;
        match self {
            // A direct prompt error.
            Self::Prompt(PromptError::PromptCancelled { .. }) => true,
            // The agent loop streams its errors, so a cancellation surfaces
            // wrapped: `Streaming(Prompt(PromptCancelled { .. }))`.
            Self::Streaming(StreamingError::Prompt(e)) => {
                matches!(**e, PromptError::PromptCancelled { .. })
            }
            _ => false,
        }
    }

    /// Classify this error for user-facing reporting.
    ///
    /// rig collapses provider HTTP failures into
    /// [`CompletionError::ProviderError`] / [`CompletionError::ResponseError`]
    /// (the HTTP status code is not preserved), so we inspect the innermost
    /// completion error: a context-window message maps to
    /// [`FailureKind::ContextOverflow`]; any other provider or transport
    /// failure maps to [`FailureKind::ProviderOutage`]; everything else is
    /// [`FailureKind::Internal`].
    pub fn failure_kind(&self) -> FailureKind {
        match self.completion_error() {
            Some(CompletionError::ProviderError(msg) | CompletionError::ResponseError(msg)) => {
                if is_context_overflow(msg) {
                    FailureKind::ContextOverflow
                } else {
                    FailureKind::ProviderOutage
                }
            }
            // Connection error / timeout — we couldn't reach the provider.
            Some(CompletionError::HttpError(_)) => FailureKind::ProviderOutage,
            _ => FailureKind::Internal,
        }
    }

    /// The innermost rig [`CompletionError`], if this error wraps one.
    fn completion_error(&self) -> Option<&CompletionError> {
        match self {
            AgentError::Completion(e) => Some(e),
            AgentError::Prompt(e) => prompt_completion_error(e),
            AgentError::Streaming(StreamingError::Completion(e)) => Some(e),
            AgentError::Streaming(StreamingError::Prompt(e)) => prompt_completion_error(e),
            _ => None,
        }
    }
}

/// Pull the [`CompletionError`] out of a [`PromptError`], if present.
fn prompt_completion_error(e: &PromptError) -> Option<&CompletionError> {
    match e {
        PromptError::CompletionError(e) => Some(e),
        _ => None,
    }
}

/// Whether a provider error message describes a context-window overflow rather
/// than an outage. Anthropic returns "prompt is too long"; OpenAI returns
/// "context_length_exceeded" / "maximum context length".
fn is_context_overflow(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    m.contains("context length")
        || m.contains("context_length")
        || m.contains("maximum context")
        || m.contains("prompt is too long")
}
