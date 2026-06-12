use agent::AgentModel;
use agent::types::AssistantMessagePart;
use model_entity::Entity;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

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
    /// the chate model to respond with
    pub model: AgentModel,
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
    ProviderError {
        stream_id: String,
        model: AgentModel,
    },

    #[error("model context overflow")]
    ModelContextOverflow { stream_id: String },

    #[error("internal error")]
    InternalError { stream_id: String },
}
