//! Port for asking the user for information during an agent turn.

use std::sync::Arc;

use async_trait::async_trait;

/// A single question the agent needs the user to answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserInputRequest {
    /// The question shown to the user.
    pub question: String,
    /// Allowed answers. An empty list requests free text.
    pub options: Vec<String>,
}

/// How the user resolved a question.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserInputOutcome {
    /// The user supplied an answer.
    Answered(String),
    /// The user explicitly declined to answer.
    Declined,
    /// The question was dismissed or the turn was stopped.
    Cancelled,
}

/// Failure to ask or decode a user-input request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserInputError {
    /// The connected ACP client did not advertise form elicitation.
    Unsupported,
    /// The client or transport refused the request.
    RequestFailed(String),
    /// The client accepted the form without returning its answer.
    MissingAnswer,
}

impl std::fmt::Display for UserInputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported => f.write_str("the client does not support form elicitation"),
            Self::RequestFailed(message) => write!(f, "the client refused the question: {message}"),
            Self::MissingAnswer => f.write_str("the client accepted without returning an answer"),
        }
    }
}

impl std::error::Error for UserInputError {}

/// Capability used by a turn to ask its connected user a question.
#[async_trait]
pub trait UserInputRequester: Send + Sync {
    /// Ask one question and wait for the user's decision.
    async fn ask(&self, request: UserInputRequest) -> Result<UserInputOutcome, UserInputError>;
}

/// Shared requester carried into model-callable tools.
pub type SharedUserInputRequester = Arc<dyn UserInputRequester>;
