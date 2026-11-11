use agent::types::AssistantMessagePart;
use model_entity::Entity;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, ToSchema, Debug, Clone, Default)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ToolSet {
    #[default]
    All,
    None,
    /// Built-in database discovery, queries, schema edits, and views.
    Databases,
    /// Database discovery and queries that cannot modify records or views.
    DatabasesReadOnly,
}

#[derive(Serialize, Deserialize, ToSchema, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatStream {
    /// Misc error
    Error(StreamError),

    /// The user message that initiated this stream, sent as the first item
    /// so other clients can add it to their local chat state.
    ChatUserMessage {
        stream_id: String,
        chat_id: String,
        message_id: String,
        content: String,
        attachments: Vec<Entity<'static>>,
    },

    /// Indicates a response from the chat completion API for a given message
    ChatMessageResponse {
        stream_id: String,
        message_id: String,
        chat_id: String,
        content: AssistantMessagePart,
    },

    StreamEnd {
        stream_id: String,
    },
}

#[derive(thiserror::Error, Debug, ToSchema, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", tag = "stream_error")]
pub enum StreamError {
    #[error("provider error")]
    ProviderError { stream_id: String, model: String },

    #[error("model context overflow")]
    ModelContextOverflow { stream_id: String },

    #[error("internal error")]
    InternalError { stream_id: String },
}
