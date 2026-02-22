use ai::types::AssistantMessagePart;
use ai::types::Model;
use model::chat::ChatAttachmentWithName;
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
    pub model: Model,
    /// Additional system instructions appended to the base system prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_instructions: Option<String>,
    /// Use citation prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<ChatAttachmentWithName>>,
    /// Which toolset to use. Defaults to `all`
    #[serde(default)]
    pub toolset: ToolSet,
    #[serde(flatten)]
    pub jwt: JwtPayload,
}

#[derive(Deserialize, Serialize, ToSchema, Debug, Clone, PartialEq, Copy)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ExtractionStatusEnum {
    // Extraction incomplete
    Incomplete,

    // Extraction complete, but text content is empty
    Empty,

    // Extraction complete, but text content is insufficient
    Insufficient,

    // Extraction complete and sufficient
    Complete,
}

// Akkad prospers and we cope
impl From<macro_db_client::dcs::get_document_text::ExtractionStatusEnum> for ExtractionStatusEnum {
    fn from(value: macro_db_client::dcs::get_document_text::ExtractionStatusEnum) -> Self {
        match value {
            macro_db_client::dcs::get_document_text::ExtractionStatusEnum::Complete => {
                Self::Complete
            }
            macro_db_client::dcs::get_document_text::ExtractionStatusEnum::Empty => Self::Empty,
            macro_db_client::dcs::get_document_text::ExtractionStatusEnum::Insufficient => {
                Self::Insufficient
            }
            macro_db_client::dcs::get_document_text::ExtractionStatusEnum::Incomplete => {
                Self::Incomplete
            }
        }
    }
}

#[derive(Serialize, Deserialize, ToSchema, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatStream {
    /// Misc error
    Error(StreamError),

    /// Acknowledges that a message has been received for processing
    ChatMessageAck {
        message_id: String,
        chat_id: String,
    },

    /// The user message that initiated this stream, sent as the first item
    /// so other clients can add it to their local chat state.
    ChatUserMessage {
        stream_id: String,
        chat_id: String,
        message_id: String,
        content: String,
        attachments: Vec<ChatAttachmentWithName>,
    },

    /// Indicates a response from the chat completion API for a given message
    ChatMessageResponse {
        stream_id: String,
        message_id: String,
        chat_id: String,
        content: AssistantMessagePart,
    },

    /// Indicates that a message has been finished
    ChatMessageFinished {
        message_id: String,
        chat_id: String,
        user_message_id: String,
    },

    /// Indicates that a chat has been renamed
    ChatRenamed {
        stream_id: String,
        chat_id: String,
        name: String,
    },

    /// Notifies the client that the available models have changed
    ModelSelectionChanged {
        chat_id: String,
        available_models: Vec<Model>,
        new_model: Option<Model>,
    },

    TokenCountChanged {
        chat_id: String,
        token_count: i64,
    },

    /// Status update
    ChatMessageStatusUpdate {
        chat_id: String,
        message_id: String,
        message: String,
    },

    /// Acknowledges the request to get extraction status
    /// if the `status` field is 'incomplete', we need to await the extraction status updates
    /// if the `status` field is 'empty', extraction is complete but text content is empty
    /// if the `status` field is 'complete', the extraction is already complete
    ExtractionStatusAck {
        attachment_id: String,
        status: ExtractionStatusEnum,
    },

    /// Status update for the extraction status
    ExtractionStatusUpdate {
        attachment_id: String,
        status: ExtractionStatusEnum,
    },

    /// pdf completion
    CompletionResponse {
        completion_id: String,
        content: String,
        done: bool,
    },

    CompletionStreamChunk {
        completion_id: String,
        content: String,
        done: bool,
    },

    StreamEnd {
        stream_id: String,
    },
}

#[derive(thiserror::Error, Debug, ToSchema, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case", tag = "stream_error")]
pub enum StreamError {
    #[error("provider error")]
    ProviderError { stream_id: String, model: Model },

    #[error("model context overflow")]
    ModelContextOverflow { stream_id: String },

    #[error("internal error")]
    InternalError { stream_id: String },
}
