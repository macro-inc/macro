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
}

#[cfg(test)]
mod test;
