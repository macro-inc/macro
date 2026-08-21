use rig_agent::agent::StreamingError;
use rig_agent::completion::PromptError;
use rig_core::completion::CompletionError;

/// Errors produced by the agent crate.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    /// An error from the RIG completion layer.
    #[error(transparent)]
    Completion(#[from] CompletionError),
    /// An error from the RIG prompt/agentic loop.
    #[error(transparent)]
    Prompt(#[from] PromptError),
    /// An error from the RIG streaming layer.
    #[error(transparent)]
    Streaming(#[from] StreamingError),
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

    /// The innermost rig [`CompletionError`], if this error wraps one.
    ///
    /// rig nests the underlying completion error a few different ways depending
    /// on where it surfaced (direct, prompt, or streamed); this unwraps all of
    /// them so callers can inspect the provider failure without re-implementing
    /// that archaeology. Returns `None` for errors that don't originate from a
    /// completion call (unknown model, env var, our own serialization, etc.).
    pub fn completion_error(&self) -> Option<&CompletionError> {
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
