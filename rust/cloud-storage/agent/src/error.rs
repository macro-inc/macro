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
}

pub type Result<T> = std::result::Result<T, AgentError>;
