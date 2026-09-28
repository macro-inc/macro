//! Model-callable adapter for ACP elicitation.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::select;

use crate::domain::user_input::{SharedUserInputRequester, UserInputOutcome, UserInputRequest};

/// Context required by [`AskUser`].
#[derive(Clone)]
pub struct AskUserContext {
    /// The active session's user-input port.
    pub requester: Option<SharedUserInputRequester>,
}

/// Ask the user one blocking question.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "AskUser",
    description = "Ask the user for information or a decision that is required before continuing. Use this only when the answer cannot be inferred safely. Pass options for a single-choice question, or omit them for free text. Never request passwords, API keys, authentication codes, payment details, or other secrets."
)]
pub struct AskUser {
    /// The complete, concise question shown to the user.
    #[schemars(description = "The complete, concise question shown to the user.")]
    pub question: String,
    /// Allowed answers for a single-choice question. Empty requests free text.
    #[serde(default)]
    #[schemars(
        description = "Allowed answers for a single-choice question. Omit or pass an empty list to request free text."
    )]
    pub options: Vec<String>,
}

/// Result returned to the model after the user resolves the question.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AskUserResponse {
    /// The user supplied an answer.
    Answered {
        /// The selected option or entered text.
        answer: String,
    },
    /// The user explicitly declined to answer.
    Declined,
    /// The user dismissed the question or stopped the turn.
    Cancelled,
}

impl ToolAnnotated for AskUser {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::read_only("Ask user").without_idempotent();
}

#[async_trait]
impl AsyncTool<AskUserContext> for AskUser {
    type Output = AskUserResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        service_context: ServiceContext<AskUserContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let requester = service_context
            .requester
            .as_ref()
            .ok_or_else(|| ToolCallError {
                description: "This client cannot show an interactive question.".to_owned(),
                internal_error: anyhow::anyhow!("form elicitation was not advertised"),
            })?;
        let question = self.question.trim();
        if question.is_empty() {
            return Err(ToolCallError {
                description: "AskUser requires a non-empty question.".to_owned(),
                internal_error: anyhow::anyhow!("empty AskUser question"),
            });
        }
        let mut options = Vec::with_capacity(self.options.len());
        for option in &self.options {
            let option = option.trim();
            if !option.is_empty() && !options.iter().any(|existing| existing == option) {
                options.push(option.to_owned());
            }
        }

        let answer = select! {
            biased;
            _ = request_context.cancel.cancelled() => {
                return Ok(AskUserResponse::Cancelled);
            }
            answer = requester.ask(UserInputRequest {
                question: question.to_owned(),
                options,
            }) => answer,
        }
        .map_err(|error| ToolCallError {
            description: error.to_string(),
            internal_error: anyhow::Error::new(error),
        })?;

        Ok(match answer {
            UserInputOutcome::Answered(answer) => AskUserResponse::Answered { answer },
            UserInputOutcome::Declined => AskUserResponse::Declined,
            UserInputOutcome::Cancelled => AskUserResponse::Cancelled,
        })
    }
}

#[cfg(test)]
mod test;
