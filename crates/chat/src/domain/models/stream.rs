use agent::types::AssistantMessagePart;
use model_entity::Entity;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// One item pushed through the connection gateway's live-chat stream for a
/// chat entity.
#[derive(Serialize, Deserialize, ToSchema, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatStream {
    /// Misc error
    Error(StreamError),

    /// The user message that initiated this stream, sent as the first item
    /// so other clients can add it to their local chat state.
    ChatUserMessage {
        /// Correlates every item in this stream to one prompt turn.
        stream_id: String,
        /// The chat the message belongs to.
        chat_id: String,
        /// The persisted id of the user's message.
        message_id: String,
        /// The user's message text.
        content: String,
        /// Attachments included with the message.
        attachments: Vec<Entity<'static>>,
    },

    /// Indicates a response from the chat completion API for a given message
    ChatMessageResponse {
        /// Correlates every item in this stream to one prompt turn.
        stream_id: String,
        /// The id the assistant's message will be persisted under.
        message_id: String,
        /// The chat the message belongs to.
        chat_id: String,
        /// One part of the assistant's (possibly still streaming) response.
        content: AssistantMessagePart,
    },

    /// Signals that no further items will be appended for this turn.
    StreamEnd {
        /// Correlates every item in this stream to one prompt turn.
        stream_id: String,
    },
}

/// A client-facing classification of a failure that ended a stream early.
#[derive(thiserror::Error, Debug, ToSchema, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", tag = "stream_error")]
pub enum StreamError {
    /// The model provider (or the request to it) failed.
    #[error("provider error")]
    ProviderError {
        /// The stream this error ended.
        stream_id: String,
        /// The model the request was running against.
        model: String,
    },

    /// The conversation exceeded the model's context window.
    #[error("model context overflow")]
    ModelContextOverflow {
        /// The stream this error ended.
        stream_id: String,
    },

    /// An unclassified internal error.
    #[error("internal error")]
    InternalError {
        /// The stream this error ended.
        stream_id: String,
    },
}
