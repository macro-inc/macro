use agent::{AgentError, CompletionError};
pub use chat::domain::models::{ChatStream, StreamError};
use model_entity::Entity;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone)]
pub struct JwtPayload {
    pub token: String,
}

#[derive(Serialize, Deserialize, ToSchema, Debug, Clone, Default)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ToolSet {
    #[default]
    All,
    None,
}

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone)]
pub struct SendChatMessagePayload {
    /// Stream ID for tracking the response
    pub stream_id: String,
    /// The content of the message
    pub content: String,
    /// Id of the chat the message belongs to
    pub chat_id: String,
    /// the chat model to respond with (`provider/model` id)
    pub model: String,
    /// Additional system instructions appended to the base system prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_instructions: Option<String>,
    /// Use citation prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<Entity<'static>>>,
    /// Which toolset to use. Defaults to `all`
    #[serde(default)]
    pub toolset: ToolSet,
    #[serde(flatten)]
    pub jwt: JwtPayload,
}

/// An [`AgentError`] together with the stream context needed to render it as a
/// client-facing [`StreamError`]. The agent crate doesn't (and shouldn't) know
/// how DCS classifies failures for the frontend, so the mapping lives here as a
/// `From` and carries the `stream_id` / `model` the wire variants require.
pub struct AgentStreamFailure<'a> {
    /// The error the agent loop surfaced.
    pub error: &'a AgentError,
    /// The stream the error belongs to.
    pub stream_id: &'a str,
    /// The model the request was running against.
    pub model: &'a str,
}

impl From<AgentStreamFailure<'_>> for StreamError {
    /// Classify an agent failure for user-facing reporting.
    ///
    /// rig collapses provider HTTP failures into [`CompletionError::ProviderError`]
    /// / [`CompletionError::ResponseError`] (the HTTP status code is not
    /// preserved), so we inspect the innermost completion error: a context-window
    /// message becomes [`StreamError::ModelContextOverflow`]; any other provider
    /// or transport failure becomes [`StreamError::ProviderError`] (so the
    /// frontend can prompt the user to switch models); everything else — including
    /// errors that don't wrap a completion call — is an internal error.
    fn from(failure: AgentStreamFailure<'_>) -> Self {
        let AgentStreamFailure {
            error,
            stream_id,
            model,
        } = failure;
        let stream_id = stream_id.to_string();
        match error.completion_error() {
            Some(CompletionError::ProviderError(msg) | CompletionError::ResponseError(msg))
                if is_context_overflow(msg) =>
            {
                StreamError::ModelContextOverflow { stream_id }
            }
            // Provider error / response error / connection failure or timeout —
            // we reached the wrong answer or couldn't reach the provider at all.
            Some(
                CompletionError::ProviderError(_)
                | CompletionError::ResponseError(_)
                | CompletionError::HttpError(_),
            ) => StreamError::ProviderError {
                stream_id,
                model: model.to_string(),
            },
            _ => StreamError::InternalError { stream_id },
        }
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
